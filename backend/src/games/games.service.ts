import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { BotService } from '../bot/bot.service.js';
import { Server } from 'socket.io';
import { ScoringEngine } from './scoring.engine.js';

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

  async startGameCountdown(roomId: string) {
    this.logger.log(`Starting countdown for room ${roomId}`);
    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) {
      this.logger.error(`[startGameCountdown] Room state not found: ${roomId}`);
      return;
    }
    
    const state = JSON.parse(stateStr);
    state.status = 'COUNTDOWN';

    // BUG FIX: Hem version filtresi hem null guard
    const dbQuestions = await this.prismaService.question.findMany({
      take: 5,
      include: {
        versions: {
          where: { versionNumber: 1 }
        }
      }
    });

    // BUG FIX: Filter out questions with no valid version data
    const validQuestions = dbQuestions.filter(
      q => q.versions && q.versions.length > 0 && q.versions[0]
    );

    if (validQuestions.length === 0) {
      this.logger.error(`[startGameCountdown] No valid questions found in DB! Cannot start game for room ${roomId}`);
      // BUG FIX: Notify players instead of silently hanging
      this.server.to(roomId).emit('error', { code: 'NO_QUESTIONS', message: 'Oyun başlatılamadı: Soru bulunamadı.' });
      return;
    }

    // Veritabanı verisini oyun state formatına çevir
    state.questions = validQuestions.map((q, idx) => ({
      index: idx,
      type: q.type,
      text: q.versions[0].text,
      metadata: q.versions[0].metadata,
      correctAnswer: q.versions[0].correctAnswer,
      durationMs: 10000,
    }));

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

    try {
      const allPlayerIds = state.players.map((p: any) => p.userId);
      await this.walletService.settleMatch(roomId, winnerId, state.entryFee, allPlayerIds);
      
      this.logger.log(`Game ${roomId} finished & settled. Winner: ${winnerId}`);
      
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
      
      this.server.to(roomId).emit('game_finished', {
        winnerId,
        finalLeaderboard: sortedPlayers,
        rewards: { coins: state.entryFee ? (state.entryFee * state.players.length) * 0.9 : 0, ratingChange: 20 }
      });
    } catch (e) {
      this.logger.error(`Error settling match ${roomId}: ${(e as Error).message}`);
      
      // Hata olsa da oyunu bitir ki odada kalmasınlar
      this.server.to(roomId).emit('game_finished', {
        winnerId,
        finalLeaderboard: sortedPlayers,
        rewards: { coins: 0, ratingChange: 0 }
      });
    }
  }
}
