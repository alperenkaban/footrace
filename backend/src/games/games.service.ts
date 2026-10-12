import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { BotService } from '../bot/bot.service.js';
import { Server } from 'socket.io';
import { ScoringEngine } from './scoring.engine.js';
import { QuestionSelector } from './question-selector.js';

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);
  private server: Server; // GameGateway üzerinden initialize edilecek

  constructor(
    private readonly redisService: RedisService,
    private readonly prismaService: PrismaService,
    private readonly walletService: WalletService,
    private readonly botService: BotService,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  notifyPlayersMatchFound(roomId: string, players: string[]) {
    // Her oyuncunun kendi userId odasına mesaj atıyoruz
    for (const userId of players) {
      this.server.to(userId).emit('match_found', { roomId, players });
    }
  }

  /**
   * Maçın canlılık (liveness) zamanını hem Redis hem PostgreSQL seviyesinde günceller.
   * Böylece aktif maçlar reconciliation tarafından asla yanlışlıkla iptal edilmez.
   */
  async updateMatchActivity(roomId: string): Promise<void> {
    try {
      const now = Date.now();
      await this.redisService.set(`match_activity:${roomId}`, now.toString(), 3600);
      const stateStr = await this.redisService.get(`room:${roomId}`);
      if (stateStr) {
        try {
          const state = JSON.parse(stateStr);
          state.lastActivityAt = now;
          await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);
        } catch {}
      }
      // PostgreSQL kalıcı canlılık güncellemesi (Redis anahtarı kaybolsa dahi korur)
      if (this.prismaService?.matchHold?.updateMany) {
        await this.prismaService.matchHold.updateMany({
          where: { matchId: roomId, status: 'HELD' },
          data: { updatedAt: new Date(now) },
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to update match activity for ${roomId}: ${(err as Error).message}`);
    }
  }

  async startGameCountdown(roomId: string) {
    this.logger.log(`Starting countdown for room ${roomId}`);
    await this.updateMatchActivity(roomId);
    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) {
      this.logger.error(`[startGameCountdown] Room state not found: ${roomId}`);
      return;
    }
    
    const state = JSON.parse(stateStr);
    state.status = 'COUNTDOWN';

    // GameMode üzerinden soru sayısını ve süresini belirle
    let targetQuestionCount = 3;
    let questionDurationMs = 10000;
    if (state.gameModeName) {
      const mode = await this.prismaService.gameMode.findUnique({
        where: { name: state.gameModeName },
      });
      if (mode) {
        targetQuestionCount = mode.questionCount || 3;
        questionDurationMs = (mode.questionDuration || 10) * 1000;
      }
    }

    try {
      // Rastgele ve maç içerisinde benzersiz (tekrarsız) soruları seç
      const selectedQuestions = await QuestionSelector.selectRandomUniqueQuestions(
        this.prismaService,
        targetQuestionCount,
        questionDurationMs,
      );

      if (!selectedQuestions || selectedQuestions.length === 0) {
        throw new Error('NO_QUESTIONS');
      }

      state.questions = selectedQuestions;
    } catch (err) {
      this.logger.error(`[startGameCountdown] Soru seçimi başarısız: ${(err as Error).message}`);
      this.server.to(roomId).emit('error', {
        code: 'NO_QUESTIONS',
        message: 'Oyun başlatılamadı: Yeterli aktif soru bulunamadı.',
      });
      return;
    }

    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);

    // Herkese countdown başlat event'i gönder
    this.server.to(roomId).emit('game_countdown', { timeLeft: 3 });
    
    setTimeout(() => this.startQuestionPhase(roomId, 0), 3000);
  }

  async startQuestionPhase(roomId: string, questionIndex: number) {
    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) {
      this.logger.error(`[startQuestionPhase] Room state not found: ${roomId}`);
      return;
    }
    
    const state = JSON.parse(stateStr);

    // BUG FIX: If game was already finished (e.g. double-fire), bail out
    if (state.status === 'GAME_FINISHED') {
      this.logger.warn(`[startQuestionPhase] Room ${roomId} already finished, skipping`);
      return;
    }

    state.status = 'QUESTION_ACTIVE';
    state.currentQuestionIndex = questionIndex;
    
    const currentQuestion = state.questions?.[questionIndex];
    
    if (!currentQuestion) {
      this.logger.error(`Question ${questionIndex} not found in state!`);
      return this.finishGame(roomId);
    }

    state.currentQuestion = currentQuestion;
    state.questionEndsAt = Date.now() + currentQuestion.durationMs;
    state.givenAnswers = {}; 
    
    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);
    await this.updateMatchActivity(roomId);

    // Doğru cevap OLMADAN client'a soruyu yolla
    this.server.to(roomId).emit('question_started', {
      questionIndex,
      type: currentQuestion.type,
      text: currentQuestion.text,
      metadata: currentQuestion.metadata,
      durationMs: currentQuestion.durationMs,
      questionEndsAt: state.questionEndsAt, // BUG FIX: send absolute end time for client-side drift calc
      serverTime: Date.now(),
    });

    // Botlar için simüle edilmiş cevapları planla
    for (const p of state.players) {
      if (p.isBot) {
        this.botService.simulateAnswer(
          roomId, 
          p.userId, 
          currentQuestion, 
          this.submitAnswer.bind(this)
        );
      }
    }

    // Süre dolduğunda soruyu bitir
    setTimeout(() => this.endQuestionPhase(roomId, questionIndex), currentQuestion.durationMs);
  }

  async submitAnswer(roomId: string, userId: string, questionIndex: number, answerData: any) {
    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) return { success: false, error: 'Room not found' };
    
    const state = JSON.parse(stateStr);
    
    if (state.status !== 'QUESTION_ACTIVE' || state.currentQuestionIndex !== questionIndex) {
      return { success: false, error: 'Question not active' };
    }

    // 1 saniyelik "Grace Period" (Clock Drift Toleransı)
    if (Date.now() > state.questionEndsAt + 1000) {
      return { success: false, error: 'Time is up' };
    }

    if (state.givenAnswers[userId]) {
      return { success: false, error: 'Already answered' };
    }

    state.givenAnswers[userId] = answerData;
    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);
    await this.updateMatchActivity(roomId);

    return { success: true };
  }

  async endQuestionPhase(roomId: string, questionIndex: number) {
    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) return;
    
    const state = JSON.parse(stateStr);

    // BUG FIX: Guard against already-ended or game-finished states
    if (state.status !== 'QUESTION_ACTIVE' || state.currentQuestionIndex !== questionIndex) {
      this.logger.warn(`[endQuestionPhase] Skipping - status: ${state.status}, idx: ${state.currentQuestionIndex} vs ${questionIndex}`);
      return;
    }

    state.status = 'QUESTION_ENDED';

    // BUG FIX: null guard on currentQuestion
    const correctAnswer = state.currentQuestion?.correctAnswer;
    
    const playerResults = (state.players || []).map((p: any) => {
      const given = state.givenAnswers?.[p.userId];
      
      // BUG FIX: null-safe scoring — if no question data available, score 0
      const result = state.currentQuestion
        ? ScoringEngine.calculateScore(
            state.currentQuestion.type,
            given,
            correctAnswer,
            state.currentQuestion.metadata,
            state.givenAnswers
          )
        : { scoreGained: 0, isCorrect: false };
      
      p.score = (p.score || 0) + result.scoreGained;
      
      return {
        userId: p.userId,
        scoreGained: result.scoreGained,
        givenAnswer: given ?? null,
        isCorrect: result.isCorrect
      };
    });

    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);
    await this.updateMatchActivity(roomId);

    this.server.to(roomId).emit('question_ended', {
      questionIndex,
      correctAnswer,
      playerResults
    });

    const leaderboard = (state.players || []).map((p: any) => ({ userId: p.userId, totalScore: p.score }));
    this.server.to(roomId).emit('score_updated', { leaderboard });

    if (questionIndex >= (state.questions?.length ?? 1) - 1) {
      setTimeout(() => this.finishGame(roomId), 4000);
    } else {
      setTimeout(() => this.startQuestionPhase(roomId, questionIndex + 1), 5000);
    }
  }

  async finishGame(roomId: string) {
    const finishLockKey = `finish_lock:${roomId}`;
    const acquired = await this.redisService.setNX(finishLockKey, '1', 60);
    if (!acquired) {
      this.logger.warn(`[finishGame] Concurrent finish already in progress for room ${roomId}, skipping`);
      return;
    }

    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) return;
    
    const state = JSON.parse(stateStr);

    // BUG FIX: Idempotency — don't settle twice
    if (state.status === 'GAME_FINISHED') {
      this.logger.warn(`[finishGame] Room ${roomId} already finished, skipping double-finish`);
      return;
    }

    state.status = 'GAME_FINISHED';
    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);

    // BUG FIX: guard against empty players array crashing winnerId
    if (!state.players || state.players.length === 0) {
      this.logger.error(`[finishGame] No players in room ${roomId}`);
      return;
    }

    const sortedPlayers = [...state.players].sort((a, b) => (b.score || 0) - (a.score || 0));
    const winnerId = sortedPlayers[0].userId;

    const isPvE = Boolean(
      state.isPvE ||
      !state.entryFee ||
      state.entryFee <= 0 ||
      state.players.some((p: any) => p.isBot),
    );

    try {
      const allPlayerIds = state.players.map((p: any) => p.userId);
      await this.walletService.settleMatch(roomId, winnerId, state.entryFee || 0, allPlayerIds, isPvE);
      
      this.logger.log(`Game ${roomId} finished & settled (PvE: ${isPvE}). Winner: ${winnerId}`);
      
      // Update each player's client with new balance
      for (const p of state.players) {
        // BUG FIX: skip bots, they don't have real wallet state to emit
        if (p.isBot) continue;
        try {
          const profile = await this.prismaService.playerProfile.findUnique({ where: { userId: p.userId } });
          if (profile) {
            this.server.to(p.userId).emit('wallet_updated', {
              balance: profile.balance,
              heldBalance: profile.heldBalance,
            });
          }
        } catch (walletErr) {
          this.logger.warn(`[finishGame] Failed to fetch wallet for ${p.userId}: ${(walletErr as Error).message}`);
        }
      }
      
      const coinsReward = isPvE ? 0 : (state.entryFee ? (state.entryFee * state.players.length) * 0.9 : 0);
      const ratingReward = isPvE ? 0 : 20;

      this.server.to(roomId).emit('game_finished', {
        winnerId,
        finalLeaderboard: sortedPlayers,
        rewards: { coins: coinsReward, ratingChange: ratingReward },
        isPvE,
      });
    } catch (e) {
      this.logger.error(`Error settling match ${roomId}: ${(e as Error).message}`);
      
      // Hata olsa da oyunu bitir ki odada kalmasınlar
      this.server.to(roomId).emit('game_finished', {
        winnerId,
        finalLeaderboard: sortedPlayers,
        rewards: { coins: 0, ratingChange: 0 }
      });
    } finally {
      // Maç bittiği için oyuncuların aktif oda eşleşmesini Redis'ten temizle (tekrar eşleşebilsinler)
      for (const p of state.players) {
        await this.redisService.del(`player_room:${p.userId}`);
      }
    }
  }
}
