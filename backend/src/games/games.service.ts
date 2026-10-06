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
    if (!stateStr) return;
    
    const state = JSON.parse(stateStr);
    state.status = 'COUNTDOWN';

    // Gerçek soruları veritabanından çek (MVP için 5 soru, rastgele)
    // Prisma'da direkt rastgele çekmek zor olduğundan şimdilik hepsini çekip karıştıralım
    const dbQuestions = await this.prismaService.question.findMany({
      take: 5,
      include: {
        versions: {
          where: { versionNumber: 1 } // Şimdilik hep ilk versiyonu al
        }
      }
    });

    // Veritabanı verisini oyun state formatına çevir
    state.questions = dbQuestions.map((q, idx) => ({
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
    if (!stateStr) return;
    
    const state = JSON.parse(stateStr);
    state.status = 'QUESTION_ACTIVE';
    state.currentQuestionIndex = questionIndex;
    
    // Redis state'e kaydettiğimiz gerçek soruyu al
    const currentQuestion = state.questions[questionIndex];
    
    if (!currentQuestion) {
      this.logger.error(`Question ${questionIndex} not found in state!`);
      return this.finishGame(roomId);
    }

    state.currentQuestion = currentQuestion;
    state.questionEndsAt = Date.now() + currentQuestion.durationMs;
    // Kimlerin cevap verdiğini takip etmek için
    state.givenAnswers = {}; 
    
    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);

    // Doğru cevap OLMADAN client'a soruyu yolla
    this.server.to(roomId).emit('question_started', {
      questionIndex,
      type: currentQuestion.type,
      text: currentQuestion.text,
      metadata: currentQuestion.metadata,
      durationMs: currentQuestion.durationMs,
      serverTime: Date.now(), // Client drift hesaplaması için
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

    // Cevabı state'e kaydet (Şimdilik kimin ne kadar sürede verdiği gibi detayları atlıyoruz MVP için)
    state.givenAnswers[userId] = answerData;
    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);

    return { success: true };
  }

  async endQuestionPhase(roomId: string, questionIndex: number) {
    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) return;
    
    const state = JSON.parse(stateStr);
    if (state.status !== 'QUESTION_ACTIVE' || state.currentQuestionIndex !== questionIndex) {
       return; // Zaten bitmiş veya state kaymış
    }

    state.status = 'QUESTION_ENDED';
    
    const correctAnswer = state.currentQuestion.correctAnswer;
    const playerResults = state.players.map((p: any) => {
      const given = state.givenAnswers[p.userId];
      
      const result = ScoringEngine.calculateScore(
        state.currentQuestion.type,
        given,
        correctAnswer,
        state.currentQuestion.metadata,
        state.givenAnswers
      );
      
      p.score += result.scoreGained;
      
      return {
        userId: p.userId,
        scoreGained: result.scoreGained,
        givenAnswer: given || null,
        isCorrect: result.isCorrect
      };
    });

    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);

    // Herkese doğru cevabı ve puanları yolla
    this.server.to(roomId).emit('question_ended', {
      questionIndex,
      correctAnswer,
      playerResults
    });

    // Liderlik tablosu güncellemesi (Skorlar)
    const leaderboard = state.players.map((p: any) => ({ userId: p.userId, totalScore: p.score }));
    this.server.to(roomId).emit('score_updated', { leaderboard });

    // MVP için dbQuestions sayısına göre bitiş belirle
    if (questionIndex >= state.questions.length - 1) {
      setTimeout(() => this.finishGame(roomId), 4000);
    } else {
      setTimeout(() => this.startQuestionPhase(roomId, questionIndex + 1), 5000);
    }
  }

  async finishGame(roomId: string) {
    const stateStr = await this.redisService.get(`room:${roomId}`);
    if (!stateStr) return;
    
    const state = JSON.parse(stateStr);
    state.status = 'GAME_FINISHED';
    await this.redisService.set(`room:${roomId}`, JSON.stringify(state), 3600);

    // En yüksek skorluyu bul
    const sortedPlayers = [...state.players].sort((a, b) => b.score - a.score);
    const winnerId = sortedPlayers[0].userId;

    // Postgres Idempotent Coin Transaction
    try {
      const allPlayerIds = state.players.map((p: any) => p.userId);
      await this.walletService.settleMatch(roomId, winnerId, state.entryFee, allPlayerIds);
      
      this.logger.log(`Game ${roomId} finished & settled. Winner: ${winnerId}`);
      
      // Update each player's client with new balance
      for (const p of state.players) {
        const profile = await this.prismaService.playerProfile.findUnique({ where: { userId: p.userId } });
        if (profile) {
          this.server.to(p.userId).emit('wallet_updated', {
            balance: profile.balance,
            heldBalance: profile.heldBalance,
          });
        }
      }
      
      // Settle sonrası oyunculara oyunun bittiğini bildir
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
