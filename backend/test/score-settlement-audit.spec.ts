import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScoringEngine, QuestionType } from '../src/games/scoring.engine.js';
import { GamesService } from '../src/games/games.service.js';
import { WalletService } from '../src/wallet/wallet.service.js';
import { BotService } from '../src/bot/bot.service.js';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

describe('[Faz 5] Skor, Kazanan ve Ödül Dağıtımı Denetimi (VerificationEngine)', () => {
  // In-Memory Redis Store
  let redisStore: Map<string, any>;
  let redisServiceMock: any;

  // In-Memory Prisma Store
  let prismaStore: {
    users: Map<string, any>;
    profiles: Map<string, any>;
    gameModes: Map<string, any>;
    matches: Map<string, any>;
    matchHolds: Map<string, any>;
    coinTransactions: any[];
  };
  let prismaServiceMock: any;

  let walletService: WalletService;
  let botService: BotService;
  let gamesService: GamesService;
  let leaderboardService: LeaderboardService;
  let socketServerMock: any;

  // Helper function to create users
  const createPlayer = (id: string, name: string, balance = 1000, isBot = false, rating = 1000) => {
    prismaStore.users.set(id, {
      id,
      email: isBot ? `${name.toLowerCase()}@footquiz.local` : `${name.toLowerCase()}@test.com`,
      isBot,
      isGuest: false,
    });
    prismaStore.profiles.set(id, {
      id: `prof-${id}`,
      userId: id,
      balance,
      heldBalance: 0,
      rating,
      totalGames: 0,
      wins: 0,
      losses: 0,
    });
  };

  beforeEach(() => {
    // 1. Setup Redis Mock
    redisStore = new Map<string, any>();
    redisServiceMock = {
      get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
      set: vi.fn(async (key: string, value: any) => {
        redisStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        const existed = redisStore.has(key);
        redisStore.delete(key);
        return existed ? 1 : 0;
      }),
      setNX: vi.fn(async (key: string, value: string) => {
        if (redisStore.has(key)) return false;
        redisStore.set(key, value);
        return true;
      }),
    };

    // 2. Setup Prisma Mock
    prismaStore = {
      users: new Map(),
      profiles: new Map(),
      gameModes: new Map(),
      matches: new Map(),
      matchHolds: new Map(),
      coinTransactions: [],
    };

    prismaStore.gameModes.set('classic_10', {
      id: 'mode-classic-10',
      name: 'classic_10',
      maxPlayers: 10,
      questionCount: 10,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: true,
      isActive: true,
    });

    prismaStore.gameModes.set('quick_2', {
      id: 'mode-quick-2',
      name: 'quick_2',
      maxPlayers: 2,
      questionCount: 3,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: false,
      isActive: true,
    });

    prismaServiceMock = {
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
        return cb(prismaServiceMock);
      }),
      $queryRaw: vi.fn(async () => []),
      $queryRawUnsafe: vi.fn(async (query: string, ...params: any[]) => {
        if (query.includes('FROM "Match"')) {
          const matchId = params[0];
          const m = prismaStore.matches.get(matchId);
          return m ? [m] : [];
        }
        return [];
      }),
      user: {
        findUnique: vi.fn(async ({ where }: any) => prismaStore.users.get(where.id) || null),
        findMany: vi.fn(async ({ where }: any) => {
          let list = Array.from(prismaStore.users.values());
          if (where?.id?.in) {
            list = list.filter((u) => where.id.in.includes(u.id));
          }
          if (where?.isBot !== undefined) {
            list = list.filter((u) => u.isBot === where.isBot);
          }
          return list;
        }),
      },
      playerProfile: {
        findUnique: vi.fn(async ({ where }: any) => prismaStore.profiles.get(where.userId) || null),
        update: vi.fn(async ({ where, data }: any) => {
          const profile = prismaStore.profiles.get(where.userId);
          if (!profile) throw new Error(`PlayerProfile not found for userId ${where.userId}`);

          if (data.balance !== undefined) {
            if (typeof data.balance === 'object' && data.balance.increment) {
              profile.balance += data.balance.increment;
            } else if (typeof data.balance === 'number') {
              profile.balance = data.balance;
            }
          }
          if (data.heldBalance !== undefined) {
            if (typeof data.heldBalance === 'object') {
              if (data.heldBalance.increment) profile.heldBalance += data.heldBalance.increment;
              if (data.heldBalance.decrement) profile.heldBalance -= data.heldBalance.decrement;
            } else if (typeof data.heldBalance === 'number') {
              profile.heldBalance = data.heldBalance;
            }
          }
          if (data.rating !== undefined) {
            if (typeof data.rating === 'object' && data.rating.increment) {
              profile.rating += data.rating.increment;
            } else if (typeof data.rating === 'number') {
              profile.rating = data.rating;
            }
          }
          if (data.wins !== undefined) {
            if (typeof data.wins === 'object' && data.wins.increment) {
              profile.wins += data.wins.increment;
            } else if (typeof data.wins === 'number') {
              profile.wins = data.wins;
            }
          }
          return { ...profile };
        }),
        findMany: vi.fn(async (args: any) => {
          let list = Array.from(prismaStore.profiles.values()).map((p) => ({
            ...p,
            user: prismaStore.users.get(p.userId),
          }));

          if (args.where?.user?.isBot !== undefined) {
            list = list.filter((p) => p.user?.isBot === args.where.user.isBot);
          }

          const order = args.orderBy || [];
          list.sort((a, b) => {
            for (const clause of order) {
              if (clause.rating) {
                const diff = clause.rating === 'desc' ? b.rating - a.rating : a.rating - b.rating;
                if (diff !== 0) return diff;
              }
              if (clause.wins) {
                const diff = clause.wins === 'desc' ? b.wins - a.wins : a.wins - b.wins;
                if (diff !== 0) return diff;
              }
            }
            return 0;
          });

          if (args.take) {
            list = list.slice(0, args.take);
          }

          return list;
        }),
      },
      matchHold: {
        create: vi.fn(async ({ data }: any) => {
          const id = `hold-${Math.random().toString(36).substring(2, 9)}`;
          const hold = {
            id,
            userId: data.userId,
            amount: data.amount,
            matchId: data.matchId || null,
            gameModeId: data.gameModeId || null,
            status: data.status || 'HELD',
            createdAt: new Date(),
            updatedAt: new Date(),
            refundedAt: null,
            settledAt: null,
          };
          prismaStore.matchHolds.set(id, hold);
          return hold;
        }),
        findFirst: vi.fn(async ({ where }: any) => {
          for (const hold of prismaStore.matchHolds.values()) {
            if (where.id && hold.id !== where.id) continue;
            if (where.userId && hold.userId !== where.userId) continue;
            if (where.status && hold.status !== where.status) continue;
            if (where.matchId !== undefined && hold.matchId !== where.matchId) continue;
            return hold;
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          const result: any[] = [];
          for (const hold of prismaStore.matchHolds.values()) {
            if (where.matchId && hold.matchId !== where.matchId) continue;
            if (where.status && hold.status !== where.status) continue;
            result.push(hold);
          }
          return result;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const hold = prismaStore.matchHolds.get(where.id);
          if (hold) {
            Object.assign(hold, data, { updatedAt: new Date() });
          }
          return hold;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const hold of prismaStore.matchHolds.values()) {
            if (where.matchId && hold.matchId !== where.matchId) continue;
            if (where.status && hold.status !== where.status) continue;
            Object.assign(hold, data, { updatedAt: new Date() });
            count++;
          }
          return { count };
        }),
      },
      match: {
        findUnique: vi.fn(async ({ where }: any) => prismaStore.matches.get(where.id) || null),
        create: vi.fn(async ({ data }: any) => {
          const m = {
            id: data.id,
            gameModeId: data.gameModeId,
            status: data.status || 'ACTIVE',
            createdAt: new Date(),
            settledAt: null,
            endedAt: null,
          };
          prismaStore.matches.set(data.id, m);
          return m;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const m = prismaStore.matches.get(where.id);
          if (m) {
            Object.assign(m, data);
          }
          return m;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          const list: any[] = [];
          for (const m of prismaStore.matches.values()) {
            if (where.status && m.status !== where.status) continue;
            if (where.createdAt?.lt && m.createdAt >= where.createdAt.lt) continue;
            list.push({
              ...m,
              gameMode: prismaStore.gameModes.get(m.gameModeId) || { entryFee: 100 },
              players: [],
            });
          }
          return list;
        }),
      },
      coinTransaction: {
        findUnique: vi.fn(async ({ where }: any) => {
          const target = where.userId_type_referenceId;
          return (
            prismaStore.coinTransactions.find(
              (tx) =>
                tx.userId === target.userId &&
                tx.type === target.type &&
                tx.referenceId === target.referenceId,
            ) || null
          );
        }),
        create: vi.fn(async ({ data }: any) => {
          // Unique index check: [userId, type, referenceId]
          const existing = prismaStore.coinTransactions.find(
            (tx) =>
              tx.userId === data.userId &&
              tx.type === data.type &&
              tx.referenceId === data.referenceId,
          );
          if (existing) {
            const err: any = new Error('Unique constraint failed on CoinTransaction');
            err.code = 'P2002';
            throw err;
          }
          const record = { id: `ctx-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
          prismaStore.coinTransactions.push(record);
          return record;
        }),
      },
      gameMode: {
        findUnique: vi.fn(async ({ where }: any) => {
          return prismaStore.gameModes.get(where.name) || prismaStore.gameModes.get(where.id) || null;
        }),
      },
    };

    walletService = new WalletService(
      prismaServiceMock as unknown as PrismaService,
      redisServiceMock as unknown as RedisService,
    );

    botService = {
      simulateAnswer: vi.fn(),
    } as unknown as BotService;

    gamesService = new GamesService(
      redisServiceMock as unknown as RedisService,
      prismaServiceMock as unknown as PrismaService,
      walletService,
      botService,
    );

    socketServerMock = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };
    gamesService.setServer(socketServerMock as any);

    leaderboardService = new LeaderboardService(
      prismaServiceMock as unknown as PrismaService,
      redisServiceMock as unknown as RedisService,
    );
  });

  // =========================================================================
  // BÖLÜM 1: TÜM SORU TİPLERİNİN PUAN HESAPLAMASI VE DETERMINIZM
  // =========================================================================
  describe('1. Her Soru Tipinin Puan Hesaplaması ve Determinizm Denetimi', () => {
    it('her soru tipi için doğru ve yanlış puanlama kuralları matematiksel olarak kesin olmalıdır', () => {
      // ESTIMATION: Tam isabet 1000, %10 içinde lineer azalan, dışında 0
      expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, 500, 500).scoreGained).toBe(1000);
      expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, 525, 500).scoreGained).toBe(500); // 25 diff on 50 margin = 50%
      expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, 550, 500).scoreGained).toBe(0); // On margin border
      expect(ScoringEngine.calculateScore(QuestionType.ESTIMATION, 600, 500).scoreGained).toBe(0); // Outside

      // MULTIPLE_CHOICE: Doğru 1000, Yanlış 0
      expect(ScoringEngine.calculateScore(QuestionType.MULTIPLE_CHOICE, 'Real Madrid', 'Real Madrid').scoreGained).toBe(1000);
      expect(ScoringEngine.calculateScore(QuestionType.MULTIPLE_CHOICE, 'Chelsea', 'Real Madrid').scoreGained).toBe(0);

      // RANKING: Eksiksiz tam doğru sıra 1000, 1 hata dahi olsa 0
      expect(ScoringEngine.calculateScore(QuestionType.RANKING, ['A', 'B', 'C'], ['A', 'B', 'C']).scoreGained).toBe(1000);
      expect(ScoringEngine.calculateScore(QuestionType.RANKING, ['B', 'A', 'C'], ['A', 'B', 'C']).scoreGained).toBe(0);

      // PLAYER_GUESS: İsim ve takma ad normalizasyonunda 1000, yanlışta 0
      expect(ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Arda Güler', 'Arda Güler').scoreGained).toBe(1000);
      expect(ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'arda guler', 'Arda Güler').scoreGained).toBe(1000);
      expect(ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Güler', 'Arda Güler', { aliases: ['Güler'] }).scoreGained).toBe(1000);
      expect(ScoringEngine.calculateScore(QuestionType.PLAYER_GUESS, 'Kerem Aktürkoğlu', 'Arda Güler').scoreGained).toBe(0);

      // HARD_QUESTION: Yüksek zorluk doğru cevapta 1500, yanlışta 0
      expect(ScoringEngine.calculateScore(QuestionType.HARD_QUESTION, 'Avusturya - İsviçre', 'Avusturya - İsviçre').scoreGained).toBe(1500);
      expect(ScoringEngine.calculateScore(QuestionType.HARD_QUESTION, 'Brezilya - İtalya', 'Avusturya - İsviçre').scoreGained).toBe(0);

      // FINAL: Zirve turu doğru cevapta 2000, yanlışta 0
      expect(ScoringEngine.calculateScore(QuestionType.FINAL, 'Miroslav Klose', 'Miroslav Klose').scoreGained).toBe(2000);
      expect(ScoringEngine.calculateScore(QuestionType.FINAL, 'Pele', 'Miroslav Klose').scoreGained).toBe(0);
    });

    it('aynı soruya aynı cevabı veren farklı oyuncuların puanları kesinlikle deterministik ve eşit olmalıdır', () => {
      const qTypes = [
        { type: QuestionType.ESTIMATION, answer: 750, correct: 700 },
        { type: QuestionType.MULTIPLE_CHOICE, answer: 'Milan', correct: 'Milan' },
        { type: QuestionType.RANKING, answer: ['1', '2', '3', '4'], correct: ['1', '2', '3', '4'] },
        { type: QuestionType.PLAYER_GUESS, answer: 'hakan calhanoglu', correct: 'Hakan Çalhanoğlu' },
        { type: QuestionType.HARD_QUESTION, answer: '1930 Uruguay', correct: '1930 Uruguay' },
        { type: QuestionType.FINAL, answer: 'Just Fontaine', correct: 'Just Fontaine' },
      ];

      for (const item of qTypes) {
        // 10 farklı oyuncu aynı cevabı verdiğinde hepsi kuruşu kuruşuna aynı puanı almalı
        const scores = Array.from({ length: 10 }, () =>
          ScoringEngine.calculateScore(item.type, item.answer, item.correct).scoreGained,
        );
        const uniqueScores = new Set(scores);
        expect(uniqueScores.size).toBe(1); // Tek bir skor olmalı (determinizm garantisi)
      }
    });
  });

  // =========================================================================
  // BÖLÜM 2: EŞİTLİK DURUMLARI (TIE-BREAKING) VE SIRALAMA ALGORİTMASI
  // =========================================================================
  describe('2. Eşitlik Durumları (Tie-Breaking) ve Oyuncu Sıralaması', () => {
    it('puan eşitliğinde toplam cevaplama süresi (hız) daha iyi olan oyuncu üst sırada yer almalıdır', async () => {
      const roomId = 'room-tie-speed-test';
      const pFast = 'user-fast';
      const pSlow = 'user-slow';

      createPlayer(pFast, 'FastPlayer', 500);
      createPlayer(pSlow, 'SlowPlayer', 500);

      await prismaServiceMock.match.create({
        data: { id: roomId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        players: [
          { userId: pSlow, score: 2000, totalResponseTimeMs: 4500, hasLeft: false },
          { userId: pFast, score: 2000, totalResponseTimeMs: 1200, hasLeft: false },
        ],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));

      await gamesService.finishGame(roomId);

      // game_finished yayınındaki liderlik tablosunu incele
      const finishCall = socketServerMock.emit.mock.calls.find((c: any) => c[0] === 'game_finished');
      expect(finishCall).toBeDefined();

      const finalLeaderboard = finishCall[1].finalLeaderboard;
      const winnerId = finishCall[1].winnerId;

      // Puanları eşit olmasına rağmen hızlı cevap veren 1. olmalı
      expect(winnerId).toBe(pFast);
      expect(finalLeaderboard[0].userId).toBe(pFast);
      expect(finalLeaderboard[1].userId).toBe(pSlow);
    });

    it('puan ve süre eşitliğinde deterministik fallback (userId alfabetik sırası) uygulanmalı, asla rastgele kalmamalıdır', async () => {
      const roomId = 'room-tie-fallback-test';
      const pAlpha = 'user-aaa';
      const pBeta = 'user-zzz';

      createPlayer(pAlpha, 'Alpha', 500);
      createPlayer(pBeta, 'Beta', 500);

      await prismaServiceMock.match.create({
        data: { id: roomId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        players: [
          { userId: pBeta, score: 1000, totalResponseTimeMs: 2000, hasLeft: false },
          { userId: pAlpha, score: 1000, totalResponseTimeMs: 2000, hasLeft: false },
        ],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));

      await gamesService.finishGame(roomId);

      const finishCall = socketServerMock.emit.mock.calls.find((c: any) => c[0] === 'game_finished');
      const finalLeaderboard = finishCall[1].finalLeaderboard;

      expect(finalLeaderboard[0].userId).toBe(pAlpha); // Alfabetik olarak önce
      expect(finalLeaderboard[1].userId).toBe(pBeta);
    });

    it('maçı terk eden oyuncu (hasLeft: true) puanı daha yüksek olsa dahi aktif oyuncunun gerisinde kalmalıdır', async () => {
      const roomId = 'room-forfeit-ranking-test';
      const pQuitter = 'user-quitter-high-score';
      const pLoyal = 'user-loyal-low-score';

      createPlayer(pQuitter, 'Quitter', 500);
      createPlayer(pLoyal, 'Loyal', 500);

      await prismaServiceMock.match.create({
        data: { id: roomId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        players: [
          { userId: pQuitter, score: 5000, hasLeft: true }, // 5000 puan ama terk etmiş
          { userId: pLoyal, score: 1000, hasLeft: false },   // 1000 puan ama odada kalmış
        ],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));

      await gamesService.finishGame(roomId);

      const finishCall = socketServerMock.emit.mock.calls.find((c: any) => c[0] === 'game_finished');
      const winnerId = finishCall[1].winnerId;
      const finalLeaderboard = finishCall[1].finalLeaderboard;

      // Terk etmeyen sadık oyuncu kazanmalıdır!
      expect(winnerId).toBe(pLoyal);
      expect(finalLeaderboard[0].userId).toBe(pLoyal);
      expect(finalLeaderboard[1].userId).toBe(pQuitter);
    });
  });

  // =========================================================================
  // BÖLÜM 3: SUNUCU OTORİTESİ (SERVER-AUTHORITATIVE OUTCOMES)
  // =========================================================================
  describe('3. Sunucu Otoritesi ve İstemciye Güvenmeme (Server Authority)', () => {
    it('maç sonuçları, puanlar ve kazanan yalnızca sunucu tarafında hesaplanan duruma göre belirlenmelidir', async () => {
      const roomId = 'room-server-auth-test';
      const p1 = 'user-p1-honest';
      const p2 = 'user-p2-honest';

      createPlayer(p1, 'Honest1', 500);
      createPlayer(p2, 'Honest2', 500);

      await prismaServiceMock.match.create({
        data: { id: roomId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      const sampleQ = {
        index: 0,
        type: QuestionType.MULTIPLE_CHOICE,
        text: 'Server Auth Soru',
        correctAnswer: 'Doğru',
        durationMs: 10000,
      };

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        questions: [sampleQ],
        currentQuestion: sampleQ,
        questionStartedAt: Date.now() - 2000,
        players: [
          { userId: p1, score: 0 },
          { userId: p2, score: 0 },
        ],
        givenAnswers: {},
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));

      // p1 doğru cevap verir, p2 yanlış cevap verir
      await gamesService.submitAnswer(roomId, p1, 0, 'Doğru');
      await gamesService.submitAnswer(roomId, p2, 0, 'Yanlış');

      // Sunucu soru turunu bitirir ve puanları hesaplar
      await gamesService.endQuestionPhase(roomId, 0);

      // Oyun sonlandırılır
      await gamesService.finishGame(roomId);

      const finishCall = socketServerMock.emit.mock.calls.find((c: any) => c[0] === 'game_finished');
      expect(finishCall).toBeDefined();

      // Kazanan sunucu puanlarına göre p1 olmalıdır (1000 puan vs 0 puan)
      expect(finishCall[1].winnerId).toBe(p1);
      expect(finishCall[1].finalLeaderboard[0].score).toBe(1000);
      expect(finishCall[1].finalLeaderboard[1].score).toBe(0);
    });
  });

  // =========================================================================
  // BÖLÜM 4: 10 İNSAN OYUNCULU REKABETÇİ MAÇ EKONOMİSİ
  // =========================================================================
  describe('4. 10 İnsan Oyunculu Rekabetçi Maç Ekonomi ve Settlement Denetimi', () => {
    it('10 insan oyunculu maçta: 1000 coin havuz, %10 house cut (100 coin), 900 coin ödül, +20 rating ve +1 win kaydedilmelidir', async () => {
      const matchId = 'match-comp-10-audit';
      const winnerId = 'champ-user';
      createPlayer(winnerId, 'Champion', 500, false, 1200);

      const allPlayerIds = [winnerId];
      // Winner hold
      const wHold = await walletService.holdEntryFee(winnerId, 100, { matchId });
      expect(wHold).toBeDefined();
      expect(prismaStore.profiles.get(winnerId).balance).toBe(400);
      expect(prismaStore.profiles.get(winnerId).heldBalance).toBe(100);

      // 9 Losers
      for (let i = 2; i <= 10; i++) {
        const loserId = `loser-user-${i}`;
        createPlayer(loserId, `Loser${i}`, 500, false, 1100);
        await walletService.holdEntryFee(loserId, 100, { matchId });
        allPlayerIds.push(loserId);
      }

      await prismaServiceMock.match.create({
        data: {
          id: matchId,
          gameModeId: 'mode-classic-10',
          status: 'ACTIVE',
        },
      });

      // Maçı settle et (10 oyuncu, 100 coin giriş ücreti)
      await walletService.settleMatch(matchId, winnerId, 100, allPlayerIds, false);

      // 1. Kazanan Profili Kontrolü
      const winnerProfile = prismaStore.profiles.get(winnerId);
      // Başlangıç: 500, hold: -100 (kalan 400), ödül: +900 -> Son bakiye: 1300
      expect(winnerProfile.balance).toBe(1300);
      expect(winnerProfile.heldBalance).toBe(0); // Bloke çözülmüş
      expect(winnerProfile.rating).toBe(1220);    // +20 rating artışı
      expect(winnerProfile.wins).toBe(1);        // +1 galibiyet sayısı

      // 2. Kaybedenlerin Kontrolü (9 oyuncu)
      for (let i = 2; i <= 10; i++) {
        const loserProfile = prismaStore.profiles.get(`loser-user-${i}`);
        expect(loserProfile.balance).toBe(400);     // 100 coin kasaya gitti
        expect(loserProfile.heldBalance).toBe(0);   // Bloke sıfırlandı
        expect(loserProfile.rating).toBe(1100);     // Rating değişmedi
        expect(loserProfile.wins).toBe(0);         // Galibiyet artmadı
      }

      // 3. MatchHold Kayıtlarının Tümü SETTLED olmalıdır
      const holds = await prismaServiceMock.matchHold.findMany({ where: { matchId } });
      expect(holds).toHaveLength(10);
      for (const h of holds) {
        expect(h.status).toBe('SETTLED');
      }

      // 4. Ledger (CoinTransaction) Kontrolü: Yalnızca 1 adet MATCH_REWARD (900 coin)
      const rewardTxs = prismaStore.coinTransactions.filter(
        (tx) => tx.referenceId === matchId && tx.type === 'MATCH_REWARD',
      );
      expect(rewardTxs).toHaveLength(1);
      expect(rewardTxs[0].userId).toBe(winnerId);
      expect(rewardTxs[0].amount).toBe(900);
      expect(rewardTxs[0].balanceBefore).toBe(400);
      expect(rewardTxs[0].balanceAfter).toBe(1300);

      // 5. Maç Durumu: SETTLED
      const match = prismaStore.matches.get(matchId);
      expect(match.status).toBe('SETTLED');
      expect(match.settledAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // BÖLÜM 5: BOTLU PVE MAÇINDA EKONOMİ KORUMASI
  // =========================================================================
  describe('5. Botlu PvE Maçında Ekonomi ve İade Kuralları', () => {
    it('botlu PvE maçında insan oyuncunun giriş ücreti iade edilmeli, havuz 0 olmalı, ödül/rating/win yazılmamalıdır', async () => {
      const matchId = 'match-pve-audit-test';
      const humanId = 'human-pve-hero';
      createPlayer(humanId, 'HeroPlayer', 500, false, 1000);

      // 9 Bot oluştur
      const botIds: string[] = [];
      for (let b = 1; b <= 9; b++) {
        const botId = `bot-eco-${b}`;
        createPlayer(botId, `Bot${b}`, 0, true, 1000);
        botIds.push(botId);
      }

      // İnsan oyuncunun ücreti hold'a alınır
      await walletService.holdEntryFee(humanId, 100, { matchId });
      expect(prismaStore.profiles.get(humanId).balance).toBe(400);
      expect(prismaStore.profiles.get(humanId).heldBalance).toBe(100);

      await prismaServiceMock.match.create({
        data: { id: matchId, gameModeId: 'mode-classic-10', status: 'ACTIVE' },
      });

      // İnsan kazanır ve settlement çağrılır
      const allPlayers = [humanId, ...botIds];
      await walletService.settleMatch(matchId, humanId, 100, allPlayers, true);

      // 1. İnsan oyuncunun 100 coini eksiksiz iade edilmiş olmalıdır
      const humanProfile = prismaStore.profiles.get(humanId);
      expect(humanProfile.balance).toBe(500);     // 400 + 100 iade = 500 (havadan para üretilmedi!)
      expect(humanProfile.heldBalance).toBe(0);   // Bloke serbest kaldı
      expect(humanProfile.rating).toBe(1000);     // Rating ARTMADI (+0)
      expect(humanProfile.wins).toBe(0);         // Wins ARTMADI (+0)

      // 2. MATCH_REFUND ledger kaydı açılmış olmalıdır
      const refundTxs = prismaStore.coinTransactions.filter(
        (tx) => tx.referenceId === matchId && tx.type === 'MATCH_REFUND',
      );
      expect(refundTxs).toHaveLength(1);
      expect(refundTxs[0].userId).toBe(humanId);
      expect(refundTxs[0].amount).toBe(100);

      // 3. Kesinlikle MATCH_REWARD (ödül) yazılmamalıdır
      const rewardTxs = prismaStore.coinTransactions.filter(
        (tx) => tx.referenceId === matchId && tx.type === 'MATCH_REWARD',
      );
      expect(rewardTxs).toHaveLength(0);

      // 4. Botlara hiçbir bakiye/rating/win yazılmamalıdır
      for (const botId of botIds) {
        const botProfile = prismaStore.profiles.get(botId);
        expect(botProfile.balance).toBe(0);
        expect(botProfile.rating).toBe(1000);
        expect(botProfile.wins).toBe(0);
      }
    });

    it('isPvE parametresi false gönderilse bile DB den bot tespit edilirse otomatik PvE koruması devreye girmelidir', async () => {
      const matchId = 'match-pve-auto-detect';
      const humanId = 'human-sneaky-caller';
      createPlayer(humanId, 'Sneaky', 500, false);
      createPlayer('bot-sneaky', 'SneakyBot', 0, true);

      await walletService.holdEntryFee(humanId, 100, { matchId });

      await prismaServiceMock.match.create({
        data: { id: matchId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      // Çağrıcı kasıtlı olarak isPvE = false gönderse bile!
      await walletService.settleMatch(matchId, humanId, 100, [humanId, 'bot-sneaky'], false);

      // Güvenlik katmanı botu tespit edip iade yapmalı, ödül dağıtmamalı
      const profile = prismaStore.profiles.get(humanId);
      expect(profile.balance).toBe(500); // 100 coin iade
      expect(profile.rating).toBe(1000);
      expect(profile.wins).toBe(0);
    });
  });

  // =========================================================================
  // BÖLÜM 6: BERABERLİK, TERK ETME, İPTAL VE YARIDA KALAN MAÇLAR
  // =========================================================================
  describe('6. Beraberlik, Terk Etme, İptal ve Yarıda Kalan Maç Senaryoları', () => {
    it('kazanan belirlenemeyen iptal/beraberlik durumunda tüm oyuncuların parası iade edilmelidir', async () => {
      const matchId = 'match-tie-no-winner';
      const p1 = 'user-tie-1';
      const p2 = 'user-tie-2';

      createPlayer(p1, 'Tie1', 500);
      createPlayer(p2, 'Tie2', 500);

      await walletService.holdEntryFee(p1, 100, { matchId });
      await walletService.holdEntryFee(p2, 100, { matchId });

      await prismaServiceMock.match.create({
        data: { id: matchId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      // winnerId boş string veya null olarak settle çağrıldığında
      await walletService.settleMatch(matchId, '', 100, [p1, p2], false);

      // İki oyuncunun parası da iade edilmeli
      expect(prismaStore.profiles.get(p1).balance).toBe(500);
      expect(prismaStore.profiles.get(p2).balance).toBe(500);
      expect(prismaStore.profiles.get(p1).heldBalance).toBe(0);
      expect(prismaStore.profiles.get(p2).heldBalance).toBe(0);

      const refunds = prismaStore.coinTransactions.filter((tx) => tx.referenceId === matchId && tx.type === 'MATCH_REFUND');
      expect(refunds).toHaveLength(2);
    });

    it('maçı terk eden oyuncunun ücreti iade edilmez, kalan aktif oyuncu maçı tamamlar', async () => {
      const roomId = 'room-abandon-flow';
      const quitter = 'user-abandon-1';
      const stayer = 'user-stay-1';

      createPlayer(quitter, 'Quitter', 500);
      createPlayer(stayer, 'Stayer', 500);

      await walletService.holdEntryFee(quitter, 100, { matchId: roomId });
      await walletService.holdEntryFee(stayer, 100, { matchId: roomId });

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        players: [
          { userId: quitter, score: 500, hasLeft: false },
          { userId: stayer, score: 200, hasLeft: false },
        ],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));

      // Quitter maçtan ayrılır
      const leaveRes = await gamesService.handlePlayerLeave(quitter, roomId);
      expect(leaveRes.success).toBe(true);

      // Quitter'ın hold'u iade edilmemiştir (hala held: 100)
      expect(prismaStore.profiles.get(quitter).balance).toBe(400);
      expect(prismaStore.profiles.get(quitter).heldBalance).toBe(100);

      // Stayer maçı tamamlar ve finishGame çağrılır
      await prismaServiceMock.match.create({
        data: { id: roomId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      await gamesService.finishGame(roomId);

      // Stayer terk etmediği için kazanır ve potu (180 coin) alır
      const stayerProfile = prismaStore.profiles.get(stayer);
      // Başlangıç: 500, hold: -100, ödül: +180 -> 580
      expect(stayerProfile.balance).toBe(580);
      expect(stayerProfile.rating).toBe(1020);
      expect(stayerProfile.wins).toBe(1);

      // Quitter'ın parası ise SETTLED olur ve kasaya/kazanana geçer
      const quitterProfile = prismaStore.profiles.get(quitter);
      expect(quitterProfile.balance).toBe(400);
      expect(quitterProfile.heldBalance).toBe(0);
    });

    it('reconcileStaleMatches: 15 dakikadır hareketsiz asılı kalan maçlar atomik ABORTED yapılmalı ve holdlar iade edilmelidir', async () => {
      const staleMatchId = 'match-stale-abandoned';
      const p1 = 'user-stale-1';
      const p2 = 'user-stale-2';

      createPlayer(p1, 'Stale1', 1000);
      createPlayer(p2, 'Stale2', 1000);

      const h1 = await walletService.holdEntryFee(p1, 100, { matchId: staleMatchId });
      const h2 = await walletService.holdEntryFee(p2, 100, { matchId: staleMatchId });

      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

      // Hold ve maç zamanlarını 20 dakika öncesine ayarla (gerçek bayat maç simülasyonu)
      if (h1?.holdId) {
        const hold1 = prismaStore.matchHolds.get(h1.holdId);
        if (hold1) {
          hold1.createdAt = twentyMinutesAgo;
          hold1.updatedAt = twentyMinutesAgo;
        }
      }
      if (h2?.holdId) {
        const hold2 = prismaStore.matchHolds.get(h2.holdId);
        if (hold2) {
          hold2.createdAt = twentyMinutesAgo;
          hold2.updatedAt = twentyMinutesAgo;
        }
      }

      prismaStore.matches.set(staleMatchId, {
        id: staleMatchId,
        gameModeId: 'mode-quick-2',
        status: 'ACTIVE',
        createdAt: twentyMinutesAgo,
        settledAt: null,
      });

      // 15 dakikalık reconciliation çalıştır
      const result = await walletService.reconcileStaleMatches(15);

      expect(result.abortedCount).toBe(1);
      expect(result.refundedCount).toBe(2);

      // Maç ABORTED olmalı
      const match = prismaStore.matches.get(staleMatchId);
      expect(match.status).toBe('ABORTED');
      expect(match.settledAt).toBeInstanceOf(Date);

      // İki oyuncunun parası da iade edilmeli
      expect(prismaStore.profiles.get(p1).balance).toBe(1000);
      expect(prismaStore.profiles.get(p1).heldBalance).toBe(0);
      expect(prismaStore.profiles.get(p2).balance).toBe(1000);
      expect(prismaStore.profiles.get(p2).heldBalance).toBe(0);
    });
  });

  // =========================================================================
  // BÖLÜM 7: EŞZAMANLI SETTLEMENT İDEMPOTENCY (TEK ÖDÜL KAYDI KANITI)
  // =========================================================================
  describe('7. Eşzamanlı Settlement Çağrılarında İdempotency Garantisi', () => {
    it('aynı maç için eşzamanlı 3 paralel settleMatch çağrısında ödül yalnızca 1 kez verilmeli, tek CoinTransaction oluşmalıdır', async () => {
      const matchId = 'match-race-concurrency';
      const winnerId = 'lucky-winner-race';
      const loserId = 'unlucky-loser-race';

      createPlayer(winnerId, 'LuckyWinner', 500);
      createPlayer(loserId, 'UnluckyLoser', 500);

      await walletService.holdEntryFee(winnerId, 100, { matchId });
      await walletService.holdEntryFee(loserId, 100, { matchId });

      await prismaServiceMock.match.create({
        data: { id: matchId, gameModeId: 'mode-quick-2', status: 'ACTIVE' },
      });

      // Eşzamanlı 3 paralel settleMatch çağrısı
      const [res1, res2, res3] = await Promise.allSettled([
        walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId], false),
        walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId], false),
        walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId], false),
      ]);

      expect(res1.status).toBe('fulfilled');
      expect(res2.status).toBe('fulfilled');
      expect(res3.status).toBe('fulfilled');

      // 1. Kazananın bakiyesi SADECE 1 KEZ artmış olmalıdır
      // Başlangıç: 500, hold: -100, net ödül: +180 -> 580 (asla 500 - 100 + 3*180 = 940 olamaz!)
      const winnerProfile = prismaStore.profiles.get(winnerId);
      expect(winnerProfile.balance).toBe(580);
      expect(winnerProfile.rating).toBe(1020);
      expect(winnerProfile.wins).toBe(1);

      // 2. CoinTransaction tablosunda TEK BİR ödül kaydı olmalıdır
      const rewardTxs = prismaStore.coinTransactions.filter(
        (tx) => tx.referenceId === matchId && tx.type === 'MATCH_REWARD',
      );
      expect(rewardTxs).toHaveLength(1);
      expect(rewardTxs[0].amount).toBe(180);
    });
  });

  // =========================================================================
  // BÖLÜM 8: LİDERLİK TABLOSU (LEADERBOARD) VE BOT FİLTRELEME
  // =========================================================================
  describe('8. Liderlik Tablosu Doğruluğu ve Bot Filtreleme', () => {
    it('liderlik tablosu botları kesinlikle filtrelemeli ve gerçek oyuncuları rating/wins sıralamasına göre listelemelidir', async () => {
      // 3 İnsan oyuncu ve 3 Bot oluştur
      createPlayer('human-rank-1', 'GigaChad', 1000, false, 1800);
      prismaStore.profiles.get('human-rank-1').wins = 50;

      createPlayer('human-rank-2', 'MidPlayer', 1000, false, 1400);
      prismaStore.profiles.get('human-rank-2').wins = 30;

      createPlayer('human-rank-3', 'NoobPlayer', 1000, false, 950);
      prismaStore.profiles.get('human-rank-3').wins = 5;

      createPlayer('bot-cheater-1', 'SuperBot', 0, true, 3000);
      prismaStore.profiles.get('bot-cheater-1').wins = 100;

      createPlayer('bot-cheater-2', 'MegaBot', 0, true, 2500);
      prismaStore.profiles.get('bot-cheater-2').wins = 90;

      // Rating sıralaması
      const ratingBoard = await leaderboardService.getGlobalLeaderboard(10, 'rating');

      // Botlar kesinlikle bulunmamalı
      expect(ratingBoard.some((p: any) => p.isBot === true || p.userId.startsWith('bot-'))).toBe(false);
      expect(ratingBoard).toHaveLength(3);

      // Gerçek oyuncu sıralaması
      expect(ratingBoard[0].userId).toBe('human-rank-1');
      expect(ratingBoard[0].rating).toBe(1800);
      expect(ratingBoard[0].rank).toBe(1);

      expect(ratingBoard[1].userId).toBe('human-rank-2');
      expect(ratingBoard[1].rating).toBe(1400);
      expect(ratingBoard[1].rank).toBe(2);

      expect(ratingBoard[2].userId).toBe('human-rank-3');
      expect(ratingBoard[2].rating).toBe(950);
      expect(ratingBoard[2].rank).toBe(3);

      // Wins sıralaması
      const winsBoard = await leaderboardService.getGlobalLeaderboard(10, 'wins');
      expect(winsBoard.some((p: any) => p.isBot === true)).toBe(false);
      expect(winsBoard[0].userId).toBe('human-rank-1');
      expect(winsBoard[0].wins).toBe(50);
    });
  });
});
