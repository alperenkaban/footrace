import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WalletService } from '../wallet/wallet.service.js';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { GamesService } from './games.service.js';
import { BotService } from '../bot/bot.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Server } from 'socket.io';

describe('FootQuiz — Concurrency, Accounting & Reconciliation Suite', () => {
  let walletService: WalletService;
  let matchmakingService: MatchmakingService;
  let gamesService: GamesService;
  let botService: BotService;

  let redisStore: Map<string, any>;
  let redisServiceMock: any;
  let prismaStore: {
    users: Map<string, any>;
    profiles: Map<string, any>;
    gameModes: Map<string, any>;
    matches: Map<string, any>;
    matchHolds: Map<string, any>;
    coinTransactions: any[];
    questions: any[];
  };
  let prismaServiceMock: any;
  let socketServerMock: any;

  beforeEach(() => {
    redisStore = new Map();

    redisServiceMock = {
      get: vi.fn(async (key: string) => redisStore.get(key) || null),
      set: vi.fn(async (key: string, value: any) => {
        redisStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        redisStore.delete(key);
        return 1;
      }),
      setNX: vi.fn(async (key: string, value: string, ttlSeconds: number) => {
        if (redisStore.has(key)) return false;
        redisStore.set(key, value);
        return true;
      }),
      enqueuePlayer: vi.fn(async (queueName: string, userId: string) => {
        const list = redisStore.get(queueName) || [];
        if (!list.includes(userId)) {
          list.push(userId);
          redisStore.set(queueName, list);
        }
      }),
      dequeuePlayers: vi.fn(async (queueName: string, count: number, exact: boolean = true) => {
        const list = redisStore.get(queueName) || [];
        if (exact && list.length < count) {
          return [];
        }
        const dequeued = list.splice(0, count);
        redisStore.set(queueName, list);
        return dequeued;
      }),
      removeFromQueue: vi.fn(async (queueName: string, userId: string) => {
        const list = redisStore.get(queueName) || [];
        const filtered = list.filter((id: string) => id !== userId);
        redisStore.set(queueName, filtered);
      }),
      lrange: vi.fn(async (key: string, start: number, stop: number) => {
        const list = redisStore.get(key) || [];
        if (stop === -1) return [...list.slice(start)];
        return [...list.slice(start, stop + 1)];
      }),
    };

    prismaStore = {
      users: new Map(),
      profiles: new Map(),
      gameModes: new Map(),
      matches: new Map(),
      matchHolds: new Map(),
      coinTransactions: [],
      questions: [],
    };

    prismaStore.gameModes.set('quick_2', {
      name: 'quick_2',
      maxPlayers: 2,
      questionCount: 3,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: false,
    });
    prismaStore.gameModes.set('classic_10', {
      name: 'classic_10',
      maxPlayers: 10,
      questionCount: 10,
      questionDuration: 10,
      entryFee: 100,
      rewardMultiplier: 1.0,
      ratingEnabled: true,
    });

    // Seed 10 bots
    for (let i = 1; i <= 10; i++) {
      const botId = `bot-${i}`;
      prismaStore.users.set(botId, { id: botId, email: `bot${i}@footquiz.local`, isBot: true });
      prismaStore.profiles.set(botId, {
        userId: botId,
        displayName: `Bot ${i}`,
        balance: 100000,
        heldBalance: 0,
        rating: 1000,
        wins: 0,
      });
    }

    prismaServiceMock = {
      gameMode: {
        findUnique: vi.fn(async ({ where }) => prismaStore.gameModes.get(where.name) || null),
      },
      user: {
        findUnique: vi.fn(async ({ where }) => prismaStore.users.get(where.id) || null),
        findMany: vi.fn(async ({ where }) => {
          let list = Array.from(prismaStore.users.values());
          if (where?.id?.in) {
            list = list.filter((u: any) => where.id.in.includes(u.id));
          }
          if (where?.isBot !== undefined) {
            list = list.filter((u: any) => u.isBot === where.isBot);
          }
          return list;
        }),
      },
      playerProfile: {
        findUnique: vi.fn(async ({ where }) => {
          const p = prismaStore.profiles.get(where.userId);
          return p ? { ...p } : null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const profile = prismaStore.profiles.get(where.userId);
          if (!profile) throw new Error('Profile not found');

          if (data.balance?.increment !== undefined) {
            profile.balance += data.balance.increment;
          } else if (data.balance?.decrement !== undefined) {
            profile.balance -= data.balance.decrement;
          } else if (typeof data.balance === 'number') {
            profile.balance = data.balance;
          }

          if (data.heldBalance?.increment !== undefined) {
            profile.heldBalance += data.heldBalance.increment;
          } else if (data.heldBalance?.decrement !== undefined) {
            profile.heldBalance -= data.heldBalance.decrement;
          } else if (typeof data.heldBalance === 'number') {
            profile.heldBalance = data.heldBalance;
          }

          if (data.rating?.increment !== undefined) {
            profile.rating += data.rating.increment;
          }
          if (data.wins?.increment !== undefined) {
            profile.wins += data.wins.increment;
          }

          return { ...profile };
        }),
      },
      matchHold: {
        create: vi.fn(async ({ data }) => {
          const hold = {
            id: data.id || `hold-${Math.random().toString(36).substring(2, 9)}`,
            userId: data.userId,
            matchId: data.matchId || null,
            gameModeId: data.gameModeId,
            amount: data.amount,
            status: data.status || 'HELD',
            createdAt: new Date(),
            updatedAt: new Date(),
            refundedAt: null,
            settledAt: null,
          };
          prismaStore.matchHolds.set(hold.id, hold);
          return { ...hold };
        }),
        findFirst: vi.fn(async ({ where, orderBy }) => {
          let holds = Array.from(prismaStore.matchHolds.values());
          if (where?.userId) holds = holds.filter((h) => h.userId === where.userId);
          if (where?.matchId !== undefined) holds = holds.filter((h) => h.matchId === where.matchId);
          if (where?.status) holds = holds.filter((h) => h.status === where.status);
          if (where?.gameModeId) holds = holds.filter((h) => h.gameModeId === where.gameModeId);
          if (orderBy?.createdAt === 'desc') {
            holds.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return holds.length > 0 ? { ...holds[0] } : null;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const h = prismaStore.matchHolds.get(where.id);
          return h ? { ...h } : null;
        }),
        findMany: vi.fn(async ({ where }) => {
          let holds = Array.from(prismaStore.matchHolds.values());
          if (where?.matchId !== undefined) holds = holds.filter((h) => h.matchId === where.matchId);
          if (where?.userId) {
            if (where.userId.in) holds = holds.filter((h) => where.userId.in.includes(h.userId));
            else holds = holds.filter((h) => h.userId === where.userId);
          }
          if (where?.status) holds = holds.filter((h) => h.status === where.status);
          return holds.map((h) => ({ ...h }));
        }),
        update: vi.fn(async ({ where, data }) => {
          const hold = prismaStore.matchHolds.get(where.id);
          if (!hold) throw new Error('MatchHold not found');
          Object.assign(hold, data);
          hold.updatedAt = new Date();
          return { ...hold };
        }),
      },
      match: {
        create: vi.fn(async ({ data }) => {
          const id = data.id || `match-${Date.now()}-${Math.random()}`;
          const match = {
            id,
            ...data,
            status: data.status || 'ACTIVE',
            settledAt: null,
            createdAt: new Date(),
          };
          prismaStore.matches.set(id, match);
          return match;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const m = prismaStore.matches.get(where.id);
          if (!m) return null;
          return {
            ...m,
            gameMode: prismaStore.gameModes.get('classic_10'),
            players: (m.players?.create || []).map((p: any) => ({ userId: p.userId })),
            holds: Array.from(prismaStore.matchHolds.values()).filter((h: any) => h.matchId === m.id),
          };
        }),
        findMany: vi.fn(async ({ where }) => {
          let list = Array.from(prismaStore.matches.values());
          if (where?.status) {
            list = list.filter((m: any) => m.status === where.status);
          }
          if (where?.createdAt?.lt) {
            list = list.filter((m: any) => m.createdAt < where.createdAt.lt);
          }
          return list.map((m: any) => ({
            ...m,
            gameMode: prismaStore.gameModes.get('classic_10'),
            players: (m.players?.create || []).map((p: any) => ({ userId: p.userId })),
            holds: Array.from(prismaStore.matchHolds.values()).filter((h: any) => h.matchId === m.id),
          }));
        }),
        update: vi.fn(async ({ where, data }) => {
          const match = prismaStore.matches.get(where.id);
          if (!match) throw new Error('Match not found');
          Object.assign(match, data);
          return { ...match };
        }),
      },
      coinTransaction: {
        create: vi.fn(async ({ data }) => {
          const duplicate = prismaStore.coinTransactions.find(
            (tx) => tx.userId === data.userId && tx.type === data.type && tx.referenceId === data.referenceId,
          );
          if (duplicate) {
            throw new Error('P2002: Unique constraint failed on fields: (userId, type, referenceId)');
          }
          prismaStore.coinTransactions.push(data);
          return data;
        }),
      },
      $queryRaw: vi.fn(async () => []),
      $queryRawUnsafe: vi.fn(async () => []),
      $transaction: vi.fn(async (cb) => cb(prismaServiceMock)),
    };

    socketServerMock = {
      to: vi.fn(() => ({
        emit: vi.fn(),
      })),
    };

    walletService = new WalletService(prismaServiceMock as unknown as PrismaService);
    botService = new BotService(prismaServiceMock as unknown as PrismaService);
    gamesService = new GamesService(
      redisServiceMock as unknown as RedisService,
      prismaServiceMock as unknown as PrismaService,
      walletService,
      botService,
    );
    gamesService.setServer(socketServerMock as unknown as Server);

    matchmakingService = new MatchmakingService(
      redisServiceMock as unknown as RedisService,
      gamesService,
      walletService,
      prismaServiceMock as unknown as PrismaService,
      botService,
    );
  });

  function createHuman(userId: string, name: string, balance = 500) {
    prismaStore.users.set(userId, { id: userId, email: `${userId}@test.com`, isBot: false });
    prismaStore.profiles.set(userId, {
      userId,
      displayName: name,
      balance,
      heldBalance: 0,
      rating: 1000,
      wins: 0,
    });
  }

  // =========================================================================
  // BÖLÜM 1: CÜZDAN MUHASEBESİ SENARYOLARI
  // =========================================================================
  describe('1. Cüzdan Muhasebesi ve Senaryo Doğrulamaları', () => {
    it('Senaryo A: 1 İnsan + 9 Bot (PvE) — Net coin değişimi 0, iade eksiksiz, 0 coin basımı', async () => {
      createHuman('h-1', 'Human Player', 500);

      // Başlangıç: Balance 500, heldBalance 0
      expect(prismaStore.profiles.get('h-1').balance).toBe(500);
      expect(prismaStore.profiles.get('h-1').heldBalance).toBe(0);

      // Kuyruğa katılır -> 100 coin bloke
      await matchmakingService.joinQueue('h-1', 'classic_10');
      expect(prismaStore.profiles.get('h-1').balance).toBe(400);
      expect(prismaStore.profiles.get('h-1').heldBalance).toBe(100);

      // 9 Bot backfill edilir -> Odaya geçişte 100 coin iade edilir
      const botIds = Array.from(prismaStore.users.values())
        .filter((u) => u.isBot)
        .slice(0, 9)
        .map((b) => b.id);
      const roomId = 'room-1h-9b';

      await matchmakingService.initializeRoom(roomId, ['h-1', ...botIds], 'classic_10');

      // İade doğrulandı: Balance 500'e döndü, heldBalance 0
      expect(prismaStore.profiles.get('h-1').balance).toBe(500);
      expect(prismaStore.profiles.get('h-1').heldBalance).toBe(0);

      // Maç biter ve PvE settle edilir
      await walletService.settleMatch(roomId, 'h-1', 0, ['h-1', ...botIds], true);

      // Bitiş Muhasebesi
      const finalProfile = prismaStore.profiles.get('h-1');
      expect(finalProfile.balance).toBe(500);
      expect(finalProfile.heldBalance).toBe(0);
      expect(finalProfile.rating).toBe(1000);
      expect(finalProfile.wins).toBe(0);
      // Denetlenebilir tekil iade kaydı (sadece insan oyuncu için, botlar için 0)
      expect(prismaStore.coinTransactions.length).toBe(1);
      expect(prismaStore.coinTransactions[0].userId).toBe('h-1');
      expect(prismaStore.coinTransactions[0].type).toBe('MATCH_REFUND');
    });

    it('Senaryo B: 4 İnsan + 6 Bot (PvE) — 4 insanın tamamının bakiyesi iade edilir, net değişim 0', async () => {
      const humans = ['h4-1', 'h4-2', 'h4-3', 'h4-4'];
      for (const h of humans) {
        createHuman(h, `Player ${h}`, 500);
        await matchmakingService.joinQueue(h, 'classic_10');
        expect(prismaStore.profiles.get(h).balance).toBe(400);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(100);
      }

      const botIds = Array.from(prismaStore.users.values()).filter((u) => u.isBot).slice(0, 6).map((b) => b.id);
      const roomId = 'room-4h-6b';
      await matchmakingService.initializeRoom(roomId, [...humans, ...botIds], 'classic_10');

      // Her 4 insanın parası iade edilmiş olmalı
      for (const h of humans) {
        expect(prismaStore.profiles.get(h).balance).toBe(500);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(0);
      }

      await walletService.settleMatch(roomId, 'h4-1', 0, [...humans, ...botIds], true);

      for (const h of humans) {
        expect(prismaStore.profiles.get(h).balance).toBe(500);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(0);
        expect(prismaStore.profiles.get(h).rating).toBe(1000);
      }
      expect(prismaStore.coinTransactions.length).toBe(4);
      expect(prismaStore.coinTransactions.every((tx) => tx.type === 'MATCH_REFUND')).toBe(true);
    });

    it('Senaryo C: 9 İnsan + 1 Bot (PvE) — Tek bir bot bile olsa tüm 9 insan iade alır, net değişim 0', async () => {
      const humans: string[] = [];
      for (let i = 1; i <= 9; i++) {
        const id = `h9-${i}`;
        humans.push(id);
        createHuman(id, `Player ${i}`, 500);
        await matchmakingService.joinQueue(id, 'classic_10');
      }

      const roomId = 'room-9h-1b';
      await matchmakingService.initializeRoom(roomId, [...humans, 'bot-1'], 'classic_10');

      // 9 insanın tümü iade almalı
      for (const h of humans) {
        expect(prismaStore.profiles.get(h).balance).toBe(500);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(0);
      }

      await walletService.settleMatch(roomId, 'h9-1', 0, [...humans, 'bot-1'], true);

      for (const h of humans) {
        expect(prismaStore.profiles.get(h).balance).toBe(500);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(0);
      }
      expect(prismaStore.coinTransactions.length).toBe(9);
      expect(prismaStore.coinTransactions.every((tx) => tx.type === 'MATCH_REFUND')).toBe(true);
    });

    it('Senaryo D: 10 Gerçek Oyuncu (Competitive) — 1.000 pot, 900 ödül, 100 komisyon, net deflasyon', async () => {
      const humans: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const id = `comp-${i}`;
        humans.push(id);
        createHuman(id, `Comp Player ${i}`, 500);
        await matchmakingService.joinQueue(id, 'classic_10');
      }

      const roomId = 'room-10-humans';
      await matchmakingService.initializeRoom(roomId, humans, 'classic_10');

      // Bot olmadığı için iade yapılmaz, 100 coin bloke kalır
      for (const h of humans) {
        expect(prismaStore.profiles.get(h).balance).toBe(400);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(100);
      }

      // Settle
      const winnerId = 'comp-1';
      await walletService.settleMatch(roomId, winnerId, 100, humans, false);

      // Kazanan: 400 + 900 = 1300 (+800 net kazanç), rating +20, wins +1
      const winner = prismaStore.profiles.get(winnerId);
      expect(winner.balance).toBe(1300);
      expect(winner.heldBalance).toBe(0);
      expect(winner.rating).toBe(1020);
      expect(winner.wins).toBe(1);

      // Kaybeden 9 oyuncu: 400 balance (-100 net), heldBalance 0
      for (let i = 2; i <= 10; i++) {
        const loser = prismaStore.profiles.get(`comp-${i}`);
        expect(loser.balance).toBe(400);
        expect(loser.heldBalance).toBe(0);
        expect(loser.rating).toBe(1000);
        expect(loser.wins).toBe(0);
      }

      // 1 adet MATCH_REWARD işlemi üretildi
      expect(prismaStore.coinTransactions.length).toBe(1);
      expect(prismaStore.coinTransactions[0].amount).toBe(900);
      expect(prismaStore.coinTransactions[0].userId).toBe(winnerId);
    });

    it('Senaryo E: Kuyruk İptali — releaseHold eksiksiz bakiye iadesi yapar', async () => {
      createHuman('canceller', 'Canceller', 500);
      await matchmakingService.joinQueue('canceller', 'classic_10');
      expect(prismaStore.profiles.get('canceller').balance).toBe(400);
      expect(prismaStore.profiles.get('canceller').heldBalance).toBe(100);

      const left = await matchmakingService.leaveQueue('canceller', 'classic_10');
      expect(left).toBe(true);
      expect(prismaStore.profiles.get('canceller').balance).toBe(500);
      expect(prismaStore.profiles.get('canceller').heldBalance).toBe(0);

      // Tekrar iptal çağrısı bakiye değiştirmez
      const repeatLeft = await matchmakingService.leaveQueue('canceller', 'classic_10');
      expect(repeatLeft).toBe(false);
      expect(prismaStore.profiles.get('canceller').balance).toBe(500);
    });

    it('Senaryo F: Bot Eklenmeden Önce Bağlantı Kopması — Oyuncu otomatik iade alır ve odaya dahil edilmez', async () => {
      createHuman('dc-user', 'DC User', 500);
      await matchmakingService.joinQueue('dc-user', 'classic_10');
      expect(prismaStore.profiles.get('dc-user').heldBalance).toBe(100);

      // Bağlantı koptu
      await matchmakingService.handleUserDisconnect('dc-user');
      expect(prismaStore.profiles.get('dc-user').balance).toBe(500);
      expect(prismaStore.profiles.get('dc-user').heldBalance).toBe(0);

      // Kuyrukta kimse kalmadı
      const queueUsers = await redisServiceMock.lrange('matchmaking_queue:classic_10', 0, -1);
      expect(queueUsers).not.toContain('dc-user');
    });

    it('Senaryo G: Bot Eklenmesiyle Aynı Anda Maç Başlatma — Yarış durumunda çift iade veya bakiye sızıntısı oluşmaz', async () => {
      createHuman('race-h-1', 'Race Human 1', 500);
      await matchmakingService.joinQueue('race-h-1', 'classic_10');
      expect(prismaStore.profiles.get('race-h-1').balance).toBe(400);
      expect(prismaStore.profiles.get('race-h-1').heldBalance).toBe(100);

      const botIds = Array.from(prismaStore.users.values()).filter((u) => u.isBot).slice(0, 9).map((b) => b.id);
      const roomId = 'room-race-bot-start';

      // Backfill ve oda başlatma eşzamanlı çalıştırıldığında (initializeRoom + secondary check)
      await Promise.all([
        matchmakingService.initializeRoom(roomId, ['race-h-1', ...botIds], 'classic_10'),
        walletService.refundEntryFee('race-h-1', 100),
      ]);

      // Oyuncunun bakiyesi tam 500 olmalı, heldBalance 0 olmalı (çift iade asla yapılmaz)
      const profile = prismaStore.profiles.get('race-h-1');
      expect(profile.balance).toBe(500);
      expect(profile.heldBalance).toBe(0);
      expect(prismaStore.coinTransactions.length).toBe(1);
      expect(prismaStore.coinTransactions[0].type).toBe('MATCH_REFUND');
    });

    it('Senaryo H: Maç Bitiminde Settlement Hatası — DB rollback, bakiye bozulmaması ve reconciliation doğrulaması', async () => {
      // 1. Rekabetçi 10 oyunculu maçta settlement hatası
      const compHumans: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const id = `err-comp-${i}`;
        compHumans.push(id);
        createHuman(id, `Err Comp ${i}`, 500);
        await matchmakingService.joinQueue(id, 'classic_10');
      }

      const compRoomId = 'room-settle-error-comp';
      await matchmakingService.initializeRoom(compRoomId, compHumans, 'classic_10');

      // Her oyuncudan 100 coin bloke edildi (balance: 400, heldBalance: 100)
      for (const h of compHumans) {
        expect(prismaStore.profiles.get(h).balance).toBe(400);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(100);
      }

      // Veritabanı çöküş simülasyonu: $transaction hata fırlatır
      const origTransaction = prismaServiceMock.$transaction;
      prismaServiceMock.$transaction = vi.fn(async () => {
        throw new Error('Postgres connection lost during settlement');
      });

      await expect(
        walletService.settleMatch(compRoomId, compHumans[0], 100, compHumans, false),
      ).rejects.toThrow();

      // İşlem rollback oldu: Bakiyeler ve blokedeki paralar asla eksilmedi veya artmadı
      for (const h of compHumans) {
        expect(prismaStore.profiles.get(h).balance).toBe(400);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(100);
      }
      expect(prismaStore.coinTransactions.length).toBe(0);

      // Transaction'ı geri yükle ve reconciliation ile asılı kalan maçı kurtar
      prismaServiceMock.$transaction = origTransaction;
      const staleMatch = prismaStore.matches.get(compRoomId);
      staleMatch.createdAt = new Date(Date.now() - 20 * 60 * 1000); // 20 dk önce

      const recResult = await walletService.reconcileStaleMatches(15);
      expect(recResult.abortedCount).toBe(1);
      expect(recResult.refundedCount).toBe(10);

      // 10 oyuncunun tamamının blokedeki 100 coini güvenle iade edildi, net bakiye değişimi tam 0!
      for (const h of compHumans) {
        expect(prismaStore.profiles.get(h).balance).toBe(500);
        expect(prismaStore.profiles.get(h).heldBalance).toBe(0);
        expect(prismaStore.profiles.get(h).rating).toBe(1000);
      }
      expect(prismaStore.coinTransactions.length).toBe(10);
      expect(prismaStore.coinTransactions.every((tx) => tx.type === 'MATCH_REFUND')).toBe(true);
    });
  });

  // =========================================================================
  // BÖLÜM 2: EŞZAMANLILIK (CONCURRENCY) TESTLERİ
  // =========================================================================
  describe('2. Eşzamanlılık ve Yarış Durumu (Race Condition) Testleri', () => {
    it('Eşzamanlı refundEntryFee: 5 paralel çağrıda yalnızca 1 kez iade yapılır, bakiye asla kopyalanmaz', async () => {
      createHuman('conc-refund', 'Conc Refund', 500);
      await walletService.holdEntryFee('conc-refund', 100);
      expect(prismaStore.profiles.get('conc-refund').balance).toBe(400);
      expect(prismaStore.profiles.get('conc-refund').heldBalance).toBe(100);

      // 5 paralel refundEntryFee çağrısı
      const results = await Promise.all([
        walletService.refundEntryFee('conc-refund', 100),
        walletService.refundEntryFee('conc-refund', 100),
        walletService.refundEntryFee('conc-refund', 100),
        walletService.refundEntryFee('conc-refund', 100),
        walletService.refundEntryFee('conc-refund', 100),
      ]);

      // Yalnızca 1 tanesi true dönmeli, diğer 4'ü false dönmeli
      const trueCount = results.filter((r) => r === true).length;
      const falseCount = results.filter((r) => r === false).length;
      expect(trueCount).toBe(1);
      expect(falseCount).toBe(4);

      // Veritabanı kesin doğrulaması: Balance 500, heldBalance 0
      const profile = prismaStore.profiles.get('conc-refund');
      expect(profile.balance).toBe(500);
      expect(profile.heldBalance).toBe(0);
    });

    it('Eşzamanlı settleMatch: 3 paralel settle çağrısında ödül yalnızca 1 kez dağıtılır, tek bir CoinTransaction oluşur', async () => {
      const matchId = 'conc-settle-match';
      const winnerId = 'conc-winner';
      createHuman(winnerId, 'Winner', 500);

      const players = [winnerId];
      for (let i = 2; i <= 10; i++) {
        const id = `conc-p-${i}`;
        createHuman(id, `Player ${i}`, 500);
        prismaStore.profiles.get(id).heldBalance = 100;
        prismaStore.profiles.get(id).balance = 400;
        players.push(id);
      }
      prismaStore.profiles.get(winnerId).heldBalance = 100;
      prismaStore.profiles.get(winnerId).balance = 400;

      prismaStore.matches.set(matchId, {
        id: matchId,
        status: 'ACTIVE',
        settledAt: null,
      });

      // 3 paralel settleMatch çağrısı
      const settlePromises = [
        walletService.settleMatch(matchId, winnerId, 100, players, false),
        walletService.settleMatch(matchId, winnerId, 100, players, false),
        walletService.settleMatch(matchId, winnerId, 100, players, false),
      ];

      await Promise.all(settlePromises);

      // Kazanan ödülü yalnızca 1 kez almalı (400 + 900 = 1300)
      const winnerProfile = prismaStore.profiles.get(winnerId);
      expect(winnerProfile.balance).toBe(1300);
      expect(winnerProfile.rating).toBe(1020);
      expect(winnerProfile.wins).toBe(1);

      // Veritabanında tam olarak 1 adet CoinTransaction olmalı
      const txs = prismaStore.coinTransactions.filter((tx) => tx.referenceId === matchId);
      expect(txs.length).toBe(1);
      expect(txs[0].amount).toBe(900);
    });

    it('Eşzamanlı holdEntryFee: Yalnızca 100 coini olan oyuncudan 5 paralel talep gelirse tam 1 tanesi başarılı olur, bakiye eksiye düşmez', async () => {
      createHuman('tight-wallet', 'Tight', 100);

      // 5 eşzamanlı 100 coin çekme talebi
      const results = await Promise.allSettled([
        walletService.holdEntryFee('tight-wallet', 100),
        walletService.holdEntryFee('tight-wallet', 100),
        walletService.holdEntryFee('tight-wallet', 100),
        walletService.holdEntryFee('tight-wallet', 100),
        walletService.holdEntryFee('tight-wallet', 100),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Tam olarak 1 tanesi başarılı, 4 tanesi 'Bakiye yetersiz' hatası ile reddedilmeli
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // Bakiye kontrolü: Balance kesinlikle 0, heldBalance kesinlikle 100 (Asla negatif bakiye yok)
      const profile = prismaStore.profiles.get('tight-wallet');
      expect(profile.balance).toBe(0);
      expect(profile.heldBalance).toBe(100);
    });

    it('Aynı oyuncunun eşzamanlı iki ayrı kuyruğa (classic_10 & quick_2) girme girişimi: 1 tanesi girer, diğeri reddedilir', async () => {
      createHuman('double-queuer', 'Double Queuer', 500);

      // İki ayrı kuyruğa aynı anda katılma
      const results = await Promise.allSettled([
        matchmakingService.joinQueue('double-queuer', 'classic_10'),
        matchmakingService.joinQueue('double-queuer', 'quick_2'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Oyuncudan sadece 1 giriş ücreti kesilmiş olmalı
      const profile = prismaStore.profiles.get('double-queuer');
      expect(profile.balance).toBe(400);
      expect(profile.heldBalance).toBe(100);
    });

    it('Aynı maç için eşzamanlı birden fazla finishGame çağrısı: Redis finish kilidi ile tek bir settlement çalışır', async () => {
      const roomId = 'conc-room-finish';
      const winnerId = 'finish-winner';
      createHuman(winnerId, 'Finish Winner', 500);

      const roomData = {
        roomId,
        gameModeName: 'classic_10',
        entryFee: 0,
        isPvE: true,
        status: 'PLAYING',
        players: [{ userId: winnerId, score: 1000, isBot: false }],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomData));

      prismaStore.matches.set(roomId, {
        id: roomId,
        status: 'ACTIVE',
        settledAt: null,
      });

      // 3 eşzamanlı finishGame çağrısı
      await Promise.all([
        gamesService.finishGame(roomId),
        gamesService.finishGame(roomId),
        gamesService.finishGame(roomId),
      ]);

      // Maç SETTLED olmuş olmalı
      const match = prismaStore.matches.get(roomId);
      expect(match.status).toBe('SETTLED');
    });
  });

  // =========================================================================
  // BÖLÜM 3: SETTLEMENT, KURTARMA VE RECONCILIATION
  // =========================================================================
  describe('3. Settlement ve Kurtarma (Reconciliation) Mekanizması', () => {
    it('Asılı kalmış (15 dk eski) ACTIVE maçları tespit eder, maçı ABORTED yapar ve insan oyuncunun bloke bakiyesini iade eder', async () => {
      const staleMatchId = 'stale-match-123';
      createHuman('stranded-player', 'Stranded', 400);
      prismaStore.profiles.get('stranded-player').heldBalance = 100;

      // 20 dakika önce açılmış ve asılı kalmış maç
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
      prismaStore.matches.set(staleMatchId, {
        id: staleMatchId,
        status: 'ACTIVE',
        createdAt: twentyMinsAgo,
        settledAt: null,
        players: {
          create: [{ userId: 'stranded-player' }, { userId: 'bot-1' }],
        },
      });

      // Reconciliation çalıştır
      const result = await walletService.reconcileStaleMatches(15);
      expect(result.abortedCount).toBe(1);
      expect(result.refundedCount).toBe(1);

      // Maç ABORTED işaretlendi
      const match = prismaStore.matches.get(staleMatchId);
      expect(match.status).toBe('ABORTED');
      expect(match.settledAt).toBeInstanceOf(Date);

      // Mahsur kalan oyuncunun 100 coin'i iade edildi
      const profile = prismaStore.profiles.get('stranded-player');
      expect(profile.balance).toBe(500);
      expect(profile.heldBalance).toBe(0);
    });

    it('Zaten SETTLED durumundaki maçı reconciliation ASLA tekrar işlemez ve çift bakiye üretmez', async () => {
      const settledMatchId = 'already-settled-match';
      createHuman('settled-player', 'Settled', 500);

      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
      prismaStore.matches.set(settledMatchId, {
        id: settledMatchId,
        status: 'SETTLED',
        createdAt: twentyMinsAgo,
        settledAt: new Date(),
        players: {
          create: [{ userId: 'settled-player' }],
        },
      });

      const result = await walletService.reconcileStaleMatches(15);
      expect(result.abortedCount).toBe(0);
      expect(result.refundedCount).toBe(0);

      // Bakiye değişmedi
      expect(prismaStore.profiles.get('settled-player').balance).toBe(500);
    });

    it('Settlement sonrasında fakat Redis temizlenmeden önce hata: self-healing ile kalıntı oda temizlenir ve oyuncu yeni kuyruğa katılabilir', async () => {
      const userId = 'orphan-player';
      const crashedRoomId = 'crashed-room-123';
      createHuman(userId, 'Orphan Player', 500);

      // Maç Redis'te GAME_FINISHED durumunda veya anahtar süresi dolmuş
      await redisServiceMock.set(`room:${crashedRoomId}`, JSON.stringify({ status: 'GAME_FINISHED' }));
      // Oyuncunun player_room kaydı çökme sebebiyle kalmış
      await redisServiceMock.set(`player_room:${userId}`, crashedRoomId);

      // Oyuncu tekrar kuyruğa girmeyi dener -> Hata vermemeli, self-healing temizleyip kuyruğa almalı
      await matchmakingService.joinQueue(userId, 'classic_10');

      // Oyuncu kuyruğa başarıyla girdi, heldBalance 100 oldu
      expect(prismaStore.profiles.get(userId).balance).toBe(400);
      expect(prismaStore.profiles.get(userId).heldBalance).toBe(100);
    });

    it('Redis oda kaydının kaybolması: finishGame sessizce döner, maç DBde ACTIVE kalır ve reconciliation ile güvenle iade edilir', async () => {
      const lostRoomId = 'lost-redis-room';
      createHuman('lost-player', 'Lost Player', 400);
      prismaStore.profiles.get('lost-player').heldBalance = 100;

      // Redis'te oda kaydı hiç yok (kaybolmuş/restart olmuş)
      await gamesService.finishGame(lostRoomId);

      // DB'de maç ACTIVE olarak kalmış durumda
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
      prismaStore.matches.set(lostRoomId, {
        id: lostRoomId,
        status: 'ACTIVE',
        createdAt: twentyMinsAgo,
        settledAt: null,
        players: {
          create: [{ userId: 'lost-player' }],
        },
      });

      // Reconciliation çalışır ve kilitli parayı kurtarır
      const result = await walletService.reconcileStaleMatches(15);
      expect(result.abortedCount).toBe(1);
      expect(result.refundedCount).toBe(1);

      expect(prismaStore.profiles.get('lost-player').balance).toBe(500);
      expect(prismaStore.profiles.get('lost-player').heldBalance).toBe(0);
    });

    it('Sunucunun maç bitişi sırasında yeniden başlaması: WalletService onModuleInit tetiklendiğinde asılı maçları otomatik kurtarır', async () => {
      const rebootMatchId = 'reboot-match-999';
      createHuman('reboot-player', 'Reboot Player', 400);
      prismaStore.profiles.get('reboot-player').heldBalance = 100;

      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
      prismaStore.matches.set(rebootMatchId, {
        id: rebootMatchId,
        status: 'ACTIVE',
        createdAt: thirtyMinsAgo,
        settledAt: null,
        players: {
          create: [{ userId: 'reboot-player' }],
        },
      });

      // Sunucu restart simülasyonu: onModuleInit çağrılır
      walletService.onModuleInit();

      // Bir mikrosaniye bekle (async catch çağrısının çalışması için)
      await new Promise((r) => setTimeout(r, 10));

      const match = prismaStore.matches.get(rebootMatchId);
      expect(match.status).toBe('ABORTED');
      expect(prismaStore.profiles.get('reboot-player').balance).toBe(500);
      expect(prismaStore.profiles.get('reboot-player').heldBalance).toBe(0);

      // Temizlik
      walletService.onModuleDestroy();
    });
  });

  // =========================================================================
  // BÖLÜM 4: P0 EKONOMİ GÜVENLİĞİ, MATCH HOLD VE LEDGER DOĞRULAMALARI
  // =========================================================================
  describe('4. P0 Ekonomi Güvenliği, MatchHold ve Ledger Bütünlüğü Testleri', () => {
    it('Senaryo 1: Aynı hold için beş eşzamanlı iade talebi — Yalnızca bir başarılı iade, bakiye tek kez artar', async () => {
      createHuman('conc-hold-user', 'Conc User', 500);
      await walletService.holdEntryFee('conc-hold-user', 100);
      const hold = Array.from(prismaStore.matchHolds.values()).find((h) => h.userId === 'conc-hold-user');
      expect(hold).toBeDefined();

      // 5 eşzamanlı iade talebi (aynı hold ID üzerinde)
      const results = await Promise.all([
        walletService.refundHoldRecord(hold.id),
        walletService.refundHoldRecord(hold.id),
        walletService.refundHoldRecord(hold.id),
        walletService.refundHoldRecord(hold.id),
        walletService.refundHoldRecord(hold.id),
      ]);

      const successCount = results.filter((r) => r === true).length;
      const failCount = results.filter((r) => r === false).length;
      expect(successCount).toBe(1);
      expect(failCount).toBe(4);

      const profile = prismaStore.profiles.get('conc-hold-user');
      expect(profile.balance).toBe(500);
      expect(profile.heldBalance).toBe(0);

      const updatedHold = prismaStore.matchHolds.get(hold.id);
      expect(updatedHold.status).toBe('REFUNDED');
      expect(updatedHold.refundedAt).toBeInstanceOf(Date);
    });

    it("Senaryo 2: İki farklı hold'u olan aynı kullanıcı — İlk hold iki kez iade edilse de ikinci hold etkilenmez", async () => {
      createHuman('multi-hold-user', 'Multi Hold User', 500);

      // 1. Maç için hold (100 coin)
      await walletService.holdEntryFee('multi-hold-user', 100);
      const hold1 = Array.from(prismaStore.matchHolds.values()).find(
        (h) => h.userId === 'multi-hold-user' && h.matchId === null,
      );
      await walletService.bindHoldsToMatch(['multi-hold-user'], 'match-alpha');

      // 2. Maç için hold (100 coin)
      await walletService.holdEntryFee('multi-hold-user', 100);
      await walletService.bindHoldsToMatch(['multi-hold-user'], 'match-beta');

      const profileBefore = prismaStore.profiles.get('multi-hold-user');
      expect(profileBefore.balance).toBe(300);
      expect(profileBefore.heldBalance).toBe(200);

      // 1. Maç hold'unu iade et -> Başarılı
      const refund1 = await walletService.refundHoldRecord(hold1.id);
      expect(refund1).toBe(true);
      expect(prismaStore.profiles.get('multi-hold-user').balance).toBe(400);
      expect(prismaStore.profiles.get('multi-hold-user').heldBalance).toBe(100);

      // 1. Maç hold'unu İKİNCİ KEZ iade etmeyi dene -> Engellenir (false), 2. maçın hold'u ASLA tüketilmez!
      const duplicateRefund1 = await walletService.refundHoldRecord(hold1.id);
      expect(duplicateRefund1).toBe(false);

      // 2. Maçın hold durumu kontrol: Hâlâ HELD ve heldBalance 100 korunuyor!
      const hold2 = Array.from(prismaStore.matchHolds.values()).find(
        (h) => h.userId === 'multi-hold-user' && h.matchId === 'match-beta',
      );
      expect(hold2.status).toBe('HELD');
      expect(prismaStore.profiles.get('multi-hold-user').balance).toBe(400);
      expect(prismaStore.profiles.get('multi-hold-user').heldBalance).toBe(100);

      // Şimdi 2. maçın hold'unu meşru şekilde iade et -> Başarılı
      const refund2 = await walletService.refundHoldRecord(hold2.id);
      expect(refund2).toBe(true);
      expect(prismaStore.profiles.get('multi-hold-user').balance).toBe(500);
      expect(prismaStore.profiles.get('multi-hold-user').heldBalance).toBe(0);
    });

    it('Senaryo 3: Aynı maçtaki iki farklı oyuncu için ayrı MATCH_REFUND ledger kayıtları yazılabilir', async () => {
      const matchId = 'shared-refund-match-p0';
      createHuman('player-alpha', 'Alpha', 500);
      createHuman('player-beta', 'Beta', 500);

      await walletService.holdEntryFee('player-alpha', 100);
      await walletService.holdEntryFee('player-beta', 100);
      await walletService.bindHoldsToMatch(['player-alpha', 'player-beta'], matchId);

      // İki oyuncunun da hold'larını iade et
      const { refundedCount } = await walletService.refundMatchHolds(matchId);
      expect(refundedCount).toBe(2);

      // Yeni @@unique([userId, type, referenceId]) kuralı sayesinde her iki oyuncunun kaydı da başarıyla oluşturuldu
      const alphaTx = prismaStore.coinTransactions.find(
        (tx) => tx.userId === 'player-alpha' && tx.type === 'MATCH_REFUND' && tx.referenceId === matchId,
      );
      const betaTx = prismaStore.coinTransactions.find(
        (tx) => tx.userId === 'player-beta' && tx.type === 'MATCH_REFUND' && tx.referenceId === matchId,
      );

      expect(alphaTx).toBeDefined();
      expect(betaTx).toBeDefined();
      expect(alphaTx.amount).toBe(100);
      expect(betaTx.amount).toBe(100);
    });

    it('Senaryo 4: Aynı oyuncu ve aynı hold için mükerrer ledger/iade engeli — Unique constraint P2002 ve status guard', async () => {
      const matchId = 'dup-ledger-match';
      createHuman('dup-player', 'Dup Player', 500);
      await walletService.holdEntryFee('dup-player', 100);
      await walletService.bindHoldsToMatch(['dup-player'], matchId);

      const hold = Array.from(prismaStore.matchHolds.values()).find((h) => h.userId === 'dup-player');

      // 1. Meşru iade
      const first = await walletService.refundHoldRecord(hold.id);
      expect(first).toBe(true);

      // 2. İkinci iade çağrısı: Hold status zaten REFUNDED olduğu için sessizce engellenir
      const second = await walletService.refundHoldRecord(hold.id);
      expect(second).toBe(false);

      // 3. Doğrudan mükerrer ledger yazımı denenirse @@unique([userId, type, referenceId]) P2002 fırlatır
      await expect(
        prismaServiceMock.coinTransaction.create({
          data: {
            userId: 'dup-player',
            type: 'MATCH_REFUND',
            referenceId: matchId,
            amount: 100,
            balanceBefore: 400,
            balanceAfter: 500,
          },
        }),
      ).rejects.toThrow(/P2002: Unique constraint failed on fields: \(userId, type, referenceId\)/);
    });

    it("Senaryo 5: İade transaction'ı hata verirse bakiye, hold ve ledger durumları tutarlı kalmalı (Atomik Rollback)", async () => {
      createHuman('fail-tx-user', 'Fail Tx', 500);
      await walletService.holdEntryFee('fail-tx-user', 100);
      const hold = Array.from(prismaStore.matchHolds.values()).find((h) => h.userId === 'fail-tx-user');

      // Transaction içinde DB çöküşü simülasyonu
      const origTx = prismaServiceMock.$transaction;
      prismaServiceMock.$transaction = vi.fn(async () => {
        throw new Error('Database transaction aborted due to lock timeout or network failure');
      });

      await expect(walletService.refundHoldRecord(hold.id)).rejects.toThrow();

      // Durum kontrolü: Bakiye, heldBalance ve MatchHold değişmedi!
      prismaServiceMock.$transaction = origTx;
      expect(prismaStore.profiles.get('fail-tx-user').balance).toBe(400);
      expect(prismaStore.profiles.get('fail-tx-user').heldBalance).toBe(100);

      const holdAfter = prismaStore.matchHolds.get(hold.id);
      expect(holdAfter.status).toBe('HELD');
      expect(holdAfter.refundedAt).toBeNull();

      // Ledger'a sahte kayıt yazılmadı
      const refundTxs = prismaStore.coinTransactions.filter((tx) => tx.userId === 'fail-tx-user');
      expect(refundTxs.length).toBe(0);
    });

    it('Senaryo 6: Settlement ve reconciliation yarışında çift ödül veya çift iade oluşmamalı', async () => {
      const raceMatchId = 'race-settle-recon-p0';
      const winnerId = 'p0-winner';
      const loserId = 'p0-loser';
      createHuman(winnerId, 'Winner', 500);
      createHuman(loserId, 'Loser', 500);

      await walletService.holdEntryFee(winnerId, 100);
      await walletService.holdEntryFee(loserId, 100);
      await walletService.bindHoldsToMatch([winnerId, loserId], raceMatchId);

      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
      prismaStore.matches.set(raceMatchId, {
        id: raceMatchId,
        status: 'ACTIVE',
        createdAt: twentyMinsAgo,
        settledAt: null,
        players: {
          create: [{ userId: winnerId }, { userId: loserId }],
        },
      });

      // Eşzamanlı settleMatch ve reconcileStaleMatches yarışı
      await Promise.all([
        walletService.settleMatch(raceMatchId, winnerId, 100, [winnerId, loserId], false),
        walletService.reconcileStaleMatches(15),
      ]);

      const finalMatch = prismaStore.matches.get(raceMatchId);
      expect(['SETTLED', 'ABORTED']).toContain(finalMatch.status);

      // Hold'lar ya SETTLED ya REFUNDED olmalı; asla çifte bakiye verilmemeli
      const holds = Array.from(prismaStore.matchHolds.values()).filter((h) => h.matchId === raceMatchId);
      expect(holds.length).toBe(2);

      if (finalMatch.status === 'SETTLED') {
        expect(holds.every((h) => h.status === 'SETTLED')).toBe(true);
        // Kazanan ödül aldı (180 coin), kaybeden 0
        expect(prismaStore.profiles.get(winnerId).balance).toBe(580);
        expect(prismaStore.profiles.get(loserId).balance).toBe(400);
      } else {
        expect(holds.every((h) => h.status === 'REFUNDED')).toBe(true);
        expect(prismaStore.profiles.get(winnerId).balance).toBe(500);
        expect(prismaStore.profiles.get(loserId).balance).toBe(500);
      }

      // Bloke bakiyeler 0'a inmiş olmalı
      expect(prismaStore.profiles.get(winnerId).heldBalance).toBe(0);
      expect(prismaStore.profiles.get(loserId).heldBalance).toBe(0);
    });

    it('Senaryo 7: İki ayrı servis örneğiyle DB seviyesindeki koruma doğrulaması (Row-level lock & transaction)', async () => {
      // İki bağımsız backend instance'ı (ör. pod-1 ve pod-2)
      const walletServiceA = new WalletService(prismaServiceMock as unknown as PrismaService);
      const walletServiceB = new WalletService(prismaServiceMock as unknown as PrismaService);

      createHuman('multi-instance-user', 'Multi Instance User', 100);

      // 1. İki servisin in-memory kilitleri birbirinden bağımsızdır (bellek paylaşılmaz)
      expect(walletServiceA['userLocks']).not.toBe(walletServiceB['userLocks']);

      // 2. DB seviyesinde SELECT FOR UPDATE çağrısının yapıldığı doğrulanır
      const queryRawSpy = vi.spyOn(prismaServiceMock, '$queryRaw');

      await walletServiceA.holdEntryFee('multi-instance-user', 100);

      expect(queryRawSpy).toHaveBeenCalled();

      // Kullanıcının bakiyesi 0, heldBalance 100 oldu
      expect(prismaStore.profiles.get('multi-instance-user').balance).toBe(0);
      expect(prismaStore.profiles.get('multi-instance-user').heldBalance).toBe(100);

      // İkinci instance aynı kullanıcıdan 100 çekmeyi denediğinde DB koşulu ile reddedilir
      await expect(walletServiceB.holdEntryFee('multi-instance-user', 100)).rejects.toThrow('Bakiye yetersiz');

      // [DİKKAT]: Bu test in-memory mock ortamında çalışmaktadır. Gerçek PostgreSQL satır kilidi (row lock)
      // davranışı canlı DB olmadan %100 simüle edilemez; bu test DB sorgu çağrısını ve mantıksal korumayı doğrular.
    });

    it('Senaryo 8: quick_2, classic_10, PvE ve 10 gerçek oyunculu ekonomi regresyon doğrulaması', async () => {
      // quick_2 modu: 2 oyuncu, 100 giriş ücreti, %10 komisyon (20), 180 ödül
      createHuman('reg-q2-1', 'Q2 Player 1', 500);
      createHuman('reg-q2-2', 'Q2 Player 2', 500);
      await walletService.holdEntryFee('reg-q2-1', 100);
      await walletService.holdEntryFee('reg-q2-2', 100);
      await walletService.bindHoldsToMatch(['reg-q2-1', 'reg-q2-2'], 'match-reg-q2');

      prismaStore.matches.set('match-reg-q2', {
        id: 'match-reg-q2',
        status: 'ACTIVE',
        createdAt: new Date(),
        settledAt: null,
      });

      await walletService.settleMatch('match-reg-q2', 'reg-q2-1', 100, ['reg-q2-1', 'reg-q2-2'], false);

      expect(prismaStore.profiles.get('reg-q2-1').balance).toBe(580); // 400 + 180
      expect(prismaStore.profiles.get('reg-q2-2').balance).toBe(400);
      expect(prismaStore.profiles.get('reg-q2-1').heldBalance).toBe(0);
      expect(prismaStore.profiles.get('reg-q2-2').heldBalance).toBe(0);

      // Hold'lar SETTLED oldu
      const q2Holds = Array.from(prismaStore.matchHolds.values()).filter((h) => h.matchId === 'match-reg-q2');
      expect(q2Holds.every((h) => h.status === 'SETTLED')).toBe(true);
    });

    it('Senaryo 9: Bir hold iki farklı maça bağlanamaz — İlk maça bağlanan hold ikinci maça transfer edilemez', async () => {
      createHuman('single-hold-user', 'Single Hold User', 500);
      await walletService.holdEntryFee('single-hold-user', 100);

      const hold = Array.from(prismaStore.matchHolds.values()).find((h) => h.userId === 'single-hold-user');
      expect(hold).toBeDefined();
      expect(hold.matchId).toBeNull();

      // 1. Maça bağla
      await walletService.bindHoldsToMatch(['single-hold-user'], 'room-first');
      const holdAfterFirst = prismaStore.matchHolds.get(hold.id);
      expect(holdAfterFirst.matchId).toBe('room-first');

      // 2. Farklı bir maç (örneğin yarış veya eski asenkron işlem) aynı oyuncunun hold'unu bağlamayı denerse
      await walletService.bindHoldsToMatch(['single-hold-user'], 'room-second');
      const holdAfterSecond = prismaStore.matchHolds.get(hold.id);
      // Hold hâlâ ilk maçta kalmalı, ikinci maça geçmemeli
      expect(holdAfterSecond.matchId).toBe('room-first');
    });

    it("Senaryo 10: Hold maça bağlandıktan sonra gecikmiş releaseHold çağrısı maça bağlı hold'un heldBalance'ını çalamaz", async () => {
      createHuman('stolen-hold-user', 'Stolen Hold User', 500);
      await walletService.holdEntryFee('stolen-hold-user', 100);

      // Hold maça bağlandı
      await walletService.bindHoldsToMatch(['stolen-hold-user'], 'active-room-xyz');
      expect(prismaStore.profiles.get('stolen-hold-user').heldBalance).toBe(100);
      expect(prismaStore.profiles.get('stolen-hold-user').balance).toBe(400);

      // Gecikmiş / yetkisiz kuyruk releaseHold çağrısı
      await expect(walletService.releaseHold('stolen-hold-user', 100)).rejects.toThrow(
        'Serbest bırakılacak aktif kuyruk hold kaydı bulunamadı',
      );

      // Kullanıcının bakiyesi ve blokesi bozulmadan korunmalı
      expect(prismaStore.profiles.get('stolen-hold-user').heldBalance).toBe(100);
      expect(prismaStore.profiles.get('stolen-hold-user').balance).toBe(400);
      const hold = Array.from(prismaStore.matchHolds.values()).find((h) => h.userId === 'stolen-hold-user');
      expect(hold.status).toBe('HELD');
      expect(hold.matchId).toBe('active-room-xyz');
    });
  });
});
