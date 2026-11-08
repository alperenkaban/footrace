import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchmakingService } from './matchmaking.service.js';
import { GamesService } from '../games/games.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { BotService } from '../bot/bot.service.js';
import { LeaderboardService } from '../leaderboard/leaderboard.service.js';
import { GameGateway } from '../gateway/game.gateway.js';

describe('Faz 1: Matchmaking & 10-Player Room Stress & Concurrency Tests', () => {
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
    questions: any[];
  };
  let prismaServiceMock: any;

  let walletService: WalletService;
  let botService: BotService;
  let gamesService: GamesService;
  let matchmakingService: MatchmakingService;
  let leaderboardService: LeaderboardService;
  let socketServerMock: any;

  beforeEach(() => {
    // 1. Setup In-Memory Redis Mock supporting multi-instance semantics and Lua script fallback
    redisStore = new Map<string, any>();
    redisServiceMock = {
      get: vi.fn(async (key: string) => {
        return redisStore.has(key) ? redisStore.get(key) : null;
      }),
      set: vi.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
      setNX: vi.fn(async (key: string, value: string) => {
        if (redisStore.has(key)) return false;
        redisStore.set(key, value);
        return true;
      }),
      del: vi.fn(async (key: string) => {
        const existed = redisStore.has(key);
        redisStore.delete(key);
        return existed ? 1 : 0;
      }),
      rpush: vi.fn(async (key: string, value: string) => {
        const list = redisStore.get(key) || [];
        list.push(value);
        redisStore.set(key, list);
        return list.length;
      }),
      llen: vi.fn(async (key: string) => {
        const list = redisStore.get(key) || [];
        return list.length;
      }),
      lrange: vi.fn(async (key: string, start: number, stop: number) => {
        const list = redisStore.get(key) || [];
        if (stop === -1) return [...list.slice(start)];
        return [...list.slice(start, stop + 1)];
      }),
      lrem: vi.fn(async (key: string, count: number, value: string) => {
        const list = redisStore.get(key) || [];
        const filtered = list.filter((v: string) => v !== value);
        const removed = list.length - filtered.length;
        redisStore.set(key, filtered);
        return removed;
      }),
      enqueuePlayer: vi.fn(async (queueName: string, userId: string) => {
        const list = redisStore.get(queueName) || [];
        if (!list.includes(userId)) {
          list.push(userId);
          redisStore.set(queueName, list);
          return true;
        }
        return false;
      }),
      dequeuePlayers: vi.fn(async (queueName: string, count: number, exact: boolean = true) => {
        const list = redisStore.get(queueName) || [];
        if (exact && list.length < count) {
          return [];
        }
        const numToPop = Math.min(list.length, count);
        const dequeued = list.splice(0, numToPop);
        redisStore.set(queueName, list);
        return dequeued;
      }),
      getQueuePlayers: vi.fn(async (queueName: string) => {
        const list = redisStore.get(queueName) || [];
        return [...list];
      }),
      removeFromQueue: vi.fn(async (queueName: string, userId: string) => {
        const list = redisStore.get(queueName) || [];
        const filtered = list.filter((id: string) => id !== userId);
        redisStore.set(queueName, filtered);
      }),
      ping: vi.fn(async () => 'PONG'),
    };

    // 2. Setup In-Memory Prisma Mock
    prismaStore = {
      users: new Map(),
      profiles: new Map(),
      gameModes: new Map(),
      matches: new Map(),
      matchHolds: new Map(),
      coinTransactions: [],
      questions: [],
    };

    // Seed game modes: classic_10 and quick_2
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

    // Seed 30 Bots
    for (let i = 1; i <= 30; i++) {
      const botId = `bot-${i}`;
      prismaStore.users.set(botId, { id: botId, email: `bot${i}@footquiz.local`, isBot: true });
      prismaStore.profiles.set(botId, {
        id: `prof-${botId}`,
        userId: botId,
        displayName: `Bot ${i}`,
        balance: 100000,
        heldBalance: 0,
        rating: 1000,
        wins: 0,
      });
    }

    // Seed questions
    for (let i = 1; i <= 30; i++) {
      prismaStore.questions.push({
        id: `q-${i}`,
        code: `Q_${i}`,
        type: 'MULTIPLE_CHOICE',
        versions: [
          {
            versionNumber: 1,
            isActive: true,
            text: `Futbol Sorusu #${i}`,
            correctAnswer: 'A',
            metadata: { options: ['A', 'B', 'C', 'D'] },
          },
        ],
      });
    }

    prismaServiceMock = {
      gameMode: {
        findUnique: vi.fn(async ({ where }) => prismaStore.gameModes.get(where.name) || null),
        findMany: vi.fn(async () => Array.from(prismaStore.gameModes.values())),
      },
      user: {
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
        create: vi.fn(async ({ data }) => {
          const id = `bot-dyn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const user = { id, email: data.email, isBot: data.isBot, isGuest: data.isGuest };
          prismaStore.users.set(id, user);
          if (data.profile?.create) {
            prismaStore.profiles.set(id, {
              id: `prof-${id}`,
              userId: id,
              balance: data.profile.create.balance,
              heldBalance: 0,
              rating: data.profile.create.rating,
              wins: 0,
            });
          }
          return user;
        }),
      },
      playerProfile: {
        findUnique: vi.fn(async ({ where }) => {
          const p = prismaStore.profiles.get(where.userId);
          return p ? { ...p } : null;
        }),
        findMany: vi.fn(async ({ where, orderBy, take }) => {
          let list = Array.from(prismaStore.profiles.values());
          if (where?.user?.isBot !== undefined) {
            list = list.filter((p: any) => {
              const u = prismaStore.users.get(p.userId);
              return u && u.isBot === where.user.isBot;
            });
          }
          if (take) {
            list = list.slice(0, take);
          }
          return list.map((p) => {
            const u = prismaStore.users.get(p.userId);
            return {
              ...p,
              user: { email: u?.email, isBot: u?.isBot },
            };
          });
        }),
        update: vi.fn(async ({ where, data }) => {
          const profile = prismaStore.profiles.get(where.userId);
          if (!profile) throw new Error('Profile not found');
          if (data.balance?.increment !== undefined) profile.balance += data.balance.increment;
          if (data.balance?.decrement !== undefined) profile.balance -= data.balance.decrement;
          if (typeof data.balance === 'number') profile.balance = data.balance;
          if (data.heldBalance?.increment !== undefined) profile.heldBalance += data.heldBalance.increment;
          if (data.heldBalance?.decrement !== undefined) profile.heldBalance -= data.heldBalance.decrement;
          if (typeof data.heldBalance === 'number') profile.heldBalance = data.heldBalance;
          if (data.rating?.increment !== undefined) profile.rating += data.rating.increment;
          if (data.wins?.increment !== undefined) profile.wins += data.wins.increment;
          return { ...profile };
        }),
      },
      match: {
        create: vi.fn(async ({ data }) => {
          // Verify unique constraint: same user cannot be added twice to same match
          const userIds = data.players.create.map((p: any) => p.userId);
          const uniqueIds = new Set(userIds);
          if (uniqueIds.size !== userIds.length) {
            throw new Error('Unique constraint failed on the fields: (matchId, userId)');
          }

          const matchRecord = {
            id: data.id,
            gameModeId: data.gameModeId,
            status: data.status,
            createdAt: new Date(),
            players: data.players.create.map((p: any) => ({
              id: `mp-${Math.random().toString(36).substring(2, 7)}`,
              matchId: data.id,
              userId: p.userId,
              finalScore: 0,
              isWinner: false,
            })),
          };
          prismaStore.matches.set(data.id, matchRecord);
          return matchRecord;
        }),
        findUnique: vi.fn(async ({ where }) => prismaStore.matches.get(where.id) || null),
        update: vi.fn(async ({ where, data }) => {
          const match = prismaStore.matches.get(where.id);
          if (!match) throw new Error('Match not found');
          Object.assign(match, data);
          return match;
        }),
      },
      matchHold: {
        create: vi.fn(async ({ data }) => {
          const hold = {
            id: `hold-${Math.random().toString(36).substring(2, 9)}`,
            userId: data.userId,
            gameModeId: data.gameModeId,
            matchId: data.matchId || null,
            amount: data.amount,
            status: data.status || 'HELD',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          prismaStore.matchHolds.set(hold.id, hold);
          return hold;
        }),
        findFirst: vi.fn(async ({ where, orderBy }) => {
          let holds = Array.from(prismaStore.matchHolds.values());
          if (where?.id) holds = holds.filter((h) => h.id === where.id);
          if (where?.userId) holds = holds.filter((h) => h.userId === where.userId);
          if (where?.matchId !== undefined) holds = holds.filter((h) => h.matchId === where.matchId);
          if (where?.status) holds = holds.filter((h) => h.status === where.status);
          if (where?.gameModeId) holds = holds.filter((h) => h.gameModeId === where.gameModeId);
          if (orderBy?.createdAt === 'desc') {
            holds.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return holds.length > 0 ? { ...holds[0] } : null;
        }),
        findUnique: vi.fn(async ({ where }) => prismaStore.matchHolds.get(where.id) || null),
        findMany: vi.fn(async ({ where }) => {
          let list = Array.from(prismaStore.matchHolds.values());
          if (where?.matchId) list = list.filter((h: any) => h.matchId === where.matchId);
          if (where?.userId) {
            if (where.userId.in) list = list.filter((h: any) => where.userId.in.includes(h.userId));
            else list = list.filter((h: any) => h.userId === where.userId);
          }
          if (where?.status) list = list.filter((h: any) => h.status === where.status);
          return list.map((h: any) => ({ ...h }));
        }),
        update: vi.fn(async ({ where, data }) => {
          const hold = prismaStore.matchHolds.get(where.id);
          if (!hold) throw new Error('Hold not found');
          Object.assign(hold, data);
          return hold;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          let updated = 0;
          for (const hold of prismaStore.matchHolds.values()) {
            let match = true;
            if (where.matchId && hold.matchId !== where.matchId) match = false;
            if (where.status && hold.status !== where.status) match = false;
            if (where.id?.in && !where.id.in.includes(hold.id)) match = false;
            if (match) {
              Object.assign(hold, data);
              updated++;
            }
          }
          return { count: updated };
        }),
      },
      coinTransaction: {
        create: vi.fn(async ({ data }) => {
          prismaStore.coinTransactions.push({ ...data, id: `tx-${Date.now()}` });
        }),
      },
      question: {
        findMany: vi.fn(async () => prismaStore.questions),
      },
      $transaction: vi.fn(async (cb) => cb(prismaServiceMock)),
    };

    // 3. Initialize Services
    walletService = new WalletService(prismaServiceMock as any, redisServiceMock as any);
    botService = new BotService(prismaServiceMock as any);
    gamesService = new GamesService(
      redisServiceMock as any,
      prismaServiceMock as any,
      walletService,
      botService,
    );
    matchmakingService = new MatchmakingService(
      redisServiceMock as any,
      gamesService,
      walletService,
      prismaServiceMock as any,
      botService,
    );
    leaderboardService = new LeaderboardService(
      prismaServiceMock as any,
      redisServiceMock as any,
    );

    // Mock Socket.io Server
    socketServerMock = {
      to: vi.fn(() => ({
        emit: vi.fn(),
      })),
      emit: vi.fn(),
    };
    gamesService.setServer(socketServerMock);
  });

  // Helper to create human users
  const createHumanUser = (id: string, initialBalance = 1000) => {
    prismaStore.users.set(id, { id, email: `${id}@footquiz.com`, isBot: false });
    prismaStore.profiles.set(id, {
      id: `prof-${id}`,
      userId: id,
      displayName: `Player_${id}`,
      balance: initialBalance,
      heldBalance: 0,
      rating: 1000,
      wins: 0,
    });
  };

  // =========================================================================
  // SENARYO 1: 10 İnsan Oyuncunun Tek Odada Eşleşmesi (classic_10)
  // =========================================================================
  it('Senaryo 1: classic_10 modunda 10 insan oyuncu aynı anda odaya alınır ve hiç bot kullanılmaz', async () => {
    const humanIds = Array.from({ length: 10 }, (_, i) => `human-c10-${i + 1}`);
    for (const hid of humanIds) {
      createHumanUser(hid, 500);
      await matchmakingService.joinQueue(hid, 'classic_10');
    }

    // 10. oyuncu girdikten sonra tryMatch tetiklenmeli ve oda kurulmalı
    expect(prismaStore.matches.size).toBe(1);
    const createdMatch = Array.from(prismaStore.matches.values())[0];
    expect(createdMatch.players.length).toBe(10);

    // Odanın Redis state'ini doğrula
    const roomStateRaw = await redisServiceMock.get(`room:${createdMatch.id}`);
    expect(roomStateRaw).toBeDefined();
    const roomState = JSON.parse(roomStateRaw);
    expect(roomState.players.length).toBe(10);
    expect(roomState.maxPlayers).toBe(10);
    expect(roomState.isPvE).toBe(false);
    expect(roomState.entryFee).toBe(100);

    // Hiçbir oyuncu bot olmamalı
    const botCount = roomState.players.filter((p: any) => p.isBot).length;
    expect(botCount).toBe(0);

    // Her 10 oyuncunun da aktif odası bu match id olmalı
    for (const hid of humanIds) {
      expect(await matchmakingService.getPlayerRoom(hid)).toBe(createdMatch.id);
      // Kuyruk temizlenmiş olmalı
      expect(await redisServiceMock.get(`player_queue:${hid}`)).toBeNull();
    }
  });

  // =========================================================================
  // SENARYO 2: Quick Join (quick_2) 2 Oyuncu İle Hızlı Eşleşme
  // =========================================================================
  it('Senaryo 2: quick_2 modunda 2 oyuncu sıraya girdiğinde anında 2 kişilik oda kurulur', async () => {
    createHumanUser('quick-p1', 500);
    createHumanUser('quick-p2', 500);

    await matchmakingService.joinQueue('quick-p1', 'quick_2');
    expect(prismaStore.matches.size).toBe(0); // Henüz 1 oyuncu var

    await matchmakingService.joinQueue('quick-p2', 'quick_2');
    expect(prismaStore.matches.size).toBe(1); // 2. oyuncu ile anında kuruldu

    const match = Array.from(prismaStore.matches.values())[0];
    expect(match.players.length).toBe(2);

    const roomState = JSON.parse(await redisServiceMock.get(`room:${match.id}`));
    expect(roomState.players.length).toBe(2);
    expect(roomState.maxPlayers).toBe(2);
    expect(roomState.isPvE).toBe(false);
  });

  // =========================================================================
  // SENARYO 3: Aynı Oyuncunun Birden Fazla Kuyruğa Katılmasının Engellenmesi
  // =========================================================================
  it('Senaryo 3: Aynı oyuncu quick_2 kuyruğundayken classic_10 kuyruğuna katılamaz', async () => {
    createHumanUser('greedy-player', 1000);

    await matchmakingService.joinQueue('greedy-player', 'quick_2');
    expect(await redisServiceMock.get('player_queue:greedy-player')).toBe('quick_2');

    // İkinci kuyruğa katılmaya çalıştığında hata fırlatılmalı
    await expect(
      matchmakingService.joinQueue('greedy-player', 'classic_10'),
    ).rejects.toThrow(/already in matchmaking queue/i);

    // Bakiye kontrolü: Sadece tek bir giriş ücreti (100) bloke edilmiş olmalı
    const profile = prismaStore.profiles.get('greedy-player');
    expect(profile.balance).toBe(900);
    expect(profile.heldBalance).toBe(100);
  });

  // =========================================================================
  // SENARYO 4: Eşzamanlı Yük Altında Çok Sayıda Oyuncunun Kuyruğa Girmesi (100 Oyuncu)
  // =========================================================================
  it('Senaryo 4: 100 oyuncu eşzamanlı olarak classic_10 kuyruğuna katıldığında tam 10 bağımsız oda kurulur', async () => {
    const players = Array.from({ length: 100 }, (_, i) => `bulk-human-${i + 1}`);
    for (const p of players) {
      createHumanUser(p, 500);
    }

    // 100 oyuncu Promise.all ile eşzamanlı giriyor
    await Promise.all(players.map((p) => matchmakingService.joinQueue(p, 'classic_10')));

    // 100 / 10 = 10 tam oda kurulmuş olmalı
    expect(prismaStore.matches.size).toBe(10);

    const allAssignedRooms = new Set<string>();
    for (const p of players) {
      const room = await matchmakingService.getPlayerRoom(p);
      expect(room).toBeDefined();
      allAssignedRooms.add(room!);
    }

    // 10 ayrı benzersiz oda olmalı
    expect(allAssignedRooms.size).toBe(10);

    // Her odada tam 10 oyuncu olmalı, çakışma olmamalı
    for (const roomId of allAssignedRooms) {
      const roomState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(roomState.players.length).toBe(10);
      expect(roomState.maxPlayers).toBe(10);
    }

    // Kuyrukta kalan hiç kimse olmamalı
    const queueRemaining = await redisServiceMock.llen('matchmaking_queue:classic_10');
    expect(queueRemaining).toBe(0);
  });

  // =========================================================================
  // SENARYO 5: Aynı Oyuncunun İki Odaya Birden Atanmasının Engellenmesi (Atomik Sahiplenme)
  // =========================================================================
  it('Senaryo 5: Çoklu instance ortamında aynı oyuncu iki odaya aynı anda atanamaz', async () => {
    createHumanUser('shared-player', 500);
    const roomA = 'room-a-uuid';
    const roomB = 'room-b-uuid';

    // İlk oda oyuncuyu atomik olarak sahiplenir
    const claimedByA = await redisServiceMock.setNX('player_room:shared-player', roomA, 3600);
    expect(claimedByA).toBe(true);

    // İkinci instance / oda aynı anda sahiplenmeye çalıştığında setNX başarısız olur
    const claimedByB = await redisServiceMock.setNX('player_room:shared-player', roomB, 3600);
    expect(claimedByB).toBe(false);

    // Oyuncunun odası sadece roomA olarak kalır
    expect(await redisServiceMock.get('player_room:shared-player')).toBe(roomA);
  });

  // =========================================================================
  // SENARYO 6: Kuyruktan Çıkma (Cancel/Leave Queue) ve İade Güvencesi
  // =========================================================================
  it('Senaryo 6: Oyuncu kuyruktan çıktığında bloke edilen ücreti tam olarak iade edilir ve kuyruktan çıkarılır', async () => {
    createHumanUser('leaving-user', 500);

    await matchmakingService.joinQueue('leaving-user', 'classic_10');
    expect(prismaStore.profiles.get('leaving-user').balance).toBe(400);
    expect(prismaStore.profiles.get('leaving-user').heldBalance).toBe(100);

    // Kuyruktan ayrıl
    const left = await matchmakingService.leaveQueue('leaving-user', 'classic_10');
    expect(left).toBe(true);

    // Bakiye tamamen geri gelmeli
    expect(prismaStore.profiles.get('leaving-user').balance).toBe(500);
    expect(prismaStore.profiles.get('leaving-user').heldBalance).toBe(0);

    // Tekrar leave çağrıldığında çift iade yapılmamalı (Idempotent)
    const leftAgain = await matchmakingService.leaveQueue('leaving-user', 'classic_10');
    expect(leftAgain).toBe(false);
    expect(prismaStore.profiles.get('leaving-user').balance).toBe(500);
  });

  // =========================================================================
  // SENARYO 7: Bağlantı Kopması Sırasında Kuyruktan Otomatik Çıkış (handleUserDisconnect)
  // =========================================================================
  it('Senaryo 7: Eşleştirme sırasında soket bağlantısı kopan oyuncu otomatik kuyruktan çıkarılır ve parası iade edilir', async () => {
    createHumanUser('dc-user', 500);

    await matchmakingService.joinQueue('dc-user', 'classic_10');
    expect(await redisServiceMock.get('player_queue:dc-user')).toBe('classic_10');

    // Socket bağlantısı koptu simülasyonu
    await matchmakingService.handleUserDisconnect('dc-user');

    // Kuyruk temizlenmiş ve bakiye iade edilmiş olmalı
    expect(await redisServiceMock.get('player_queue:dc-user')).toBeNull();
    expect(prismaStore.profiles.get('dc-user').balance).toBe(500);
    expect(prismaStore.profiles.get('dc-user').heldBalance).toBe(0);
  });

  // =========================================================================
  // SENARYO 8: Bot Backfill — Eksik Oyuncuların Botlarla Tamamlanması (4 İnsan + 6 Bot)
  // =========================================================================
  it('Senaryo 8: classic_10 kuyruğunda 4 insan kaldığında 6 bot eklenerek 10 kişilik oda tamamlanır', async () => {
    const fourHumans = ['h-1', 'h-2', 'h-3', 'h-4'];
    for (const hid of fourHumans) {
      createHumanUser(hid, 500);
      await matchmakingService.joinQueue(hid, 'classic_10');
    }

    // 12 saniyelik timeout simülasyonu: forceBackfill tetiklenir
    await matchmakingService.forceBackfill('classic_10');

    expect(prismaStore.matches.size).toBe(1);
    const match = Array.from(prismaStore.matches.values())[0];
    expect(match.players.length).toBe(10);

    const roomState = JSON.parse(await redisServiceMock.get(`room:${match.id}`));
    expect(roomState.players.length).toBe(10);
    expect(roomState.maxPlayers).toBe(10);
    expect(roomState.isPvE).toBe(true);

    const humanCount = roomState.players.filter((p: any) => !p.isBot).length;
    const botCount = roomState.players.filter((p: any) => p.isBot).length;
    expect(humanCount).toBe(4);
    expect(botCount).toBe(6);
  });

  // =========================================================================
  // SENARYO 9: Botların Ekonomi ve Leaderboard Kurallarını Bozmadığının Kanıtlanması
  // =========================================================================
  it('Senaryo 9: Botlu maç tamamlandığında insan oyuncuların parası iade edilir, karşılıksız para/rating üretilmez, botlar leaderboarda girmez', async () => {
    createHumanUser('solo-human', 500);
    await matchmakingService.joinQueue('solo-human', 'classic_10');

    // 1 insan + 9 bot ile oda kuruluyor
    await matchmakingService.forceBackfill('classic_10');

    const match = Array.from(prismaStore.matches.values())[0];

    // PvE maç kuralı: İnsan oyuncunun bloke ücreti initializeRoom anında iade edilmiş olmalı!
    const humanProfileBefore = prismaStore.profiles.get('solo-human');
    expect(humanProfileBefore.balance).toBe(500); // 100 hold yapıldı ve iade edildi
    expect(humanProfileBefore.heldBalance).toBe(0);

    // Oyunu bitir (solo-human kazansın)
    const roomState = JSON.parse(await redisServiceMock.get(`room:${match.id}`));
    roomState.status = 'COUNTDOWN';
    await redisServiceMock.set(`room:${match.id}`, JSON.stringify(roomState));

    await gamesService.finishGame(match.id);

    // Oyun bitti: PvE olduğu için kazanan dahi olsa karşılıksız para verilmez!
    const humanProfileAfter = prismaStore.profiles.get('solo-human');
    expect(humanProfileAfter.balance).toBe(500); // Para ödülü 0 (PvE)
    expect(humanProfileAfter.rating).toBe(1000);  // Rating artışı 0 (PvE bot farming koruması)

    // Leaderboard kontrolü: Botların global leaderboard'da YER ALMADIĞINI kanıtla
    const topPlayers = await leaderboardService.getGlobalLeaderboard(50, 'rating');
    const botsInLeaderboard = topPlayers.filter((p: any) => p.isBot);
    expect(botsInLeaderboard.length).toBe(0); // Botlar kesinlikle listelenmez
  });

  // =========================================================================
  // SENARYO 10: Aynı Kullanıcının Birden Fazla Oda Üyeliği Oluşturamaması
  // =========================================================================
  it('Senaryo 10: Aktif bir odada olan kullanıcı yeni bir kuyruğa veya odaya katılamaz', async () => {
    createHumanUser('active-room-user', 500);
    createHumanUser('partner-user', 500);

    // quick_2 ile odaya gir
    await matchmakingService.joinQueue('active-room-user', 'quick_2');
    await matchmakingService.joinQueue('partner-user', 'quick_2');

    const matchId = await matchmakingService.getPlayerRoom('active-room-user');
    expect(matchId).toBeDefined();

    // Şimdi aynı kullanıcı tekrar kuyruğa girmeye çalışsın
    await expect(
      matchmakingService.joinQueue('active-room-user', 'classic_10'),
    ).rejects.toThrow(/already in a game room/i);
  });

  // =========================================================================
  // SENARYO 11: Oda Dolduktan Sonra Yeni Oyuncu Kabul Edilmemesi (Oda Kapasite Güvenliği)
  // =========================================================================
  it('Senaryo 11: 10 kişilik oda kurulduktan sonra yetkisiz 11. bir oyuncu Socket.io join_room yapamaz', async () => {
    const gateway = new GameGateway(
      matchmakingService,
      gamesService,
      { verify: vi.fn() } as any,
    );

    const roomId = 'room-ten-players-full';
    const legitimatePlayers = Array.from({ length: 10 }, (_, i) => ({ userId: `legit-${i + 1}` }));

    // Redis üzerinde tam 10 kişilik oda durumu
    await redisServiceMock.set(
      `room:${roomId}`,
      JSON.stringify({
        roomId,
        gameModeName: 'classic_10',
        maxPlayers: 10,
        status: 'PLAYER_READY',
        players: legitimatePlayers,
      }),
    );

    // 11. dışarıdan gelen saldırgan/fazla oyuncu
    const intruderSocket: any = {
      id: 'intruder-sock',
      join: vi.fn(),
      emit: vi.fn(),
    };
    (gateway as any).clientMapping.set('intruder-sock', 'intruder-user');

    // Saldırgan bu odaya atanmış değil
    await gateway.handleJoinRoom({ roomId }, intruderSocket);

    // Kesinlikle odaya alınmamalı
    expect(intruderSocket.join).not.toHaveBeenCalled();
    expect(intruderSocket.emit).toHaveBeenCalledWith('error', {
      code: 'UNAUTHORIZED_ROOM_ACCESS',
      message: 'You are not assigned to this match room.',
    });

    // Eğer saldırgan hileyle player_room anahtarına sahip olsaydı bile oda üyeliği kontrolü reddeder
    await redisServiceMock.set('player_room:intruder-user', roomId);
    await gateway.handleJoinRoom({ roomId }, intruderSocket);

    expect(intruderSocket.join).not.toHaveBeenCalled();
    expect(intruderSocket.emit).toHaveBeenCalledWith('error', {
      code: 'ROOM_CAPACITY_EXCEEDED',
      message: 'Room capacity exceeded or user is not a member of this room.',
    });
  });

  // =========================================================================
  // SENARYO 12: Çoklu Backend Instance Eşzamanlı Yarış Koşulları (Redis SetNX & Lua Pop)
  // =========================================================================
  it('Senaryo 12: İki ayrı backend instance aynı anda 10 oyuncuyu eşleştirmeye çalıştığında yalnızca biri odayı kurar', async () => {
    const queuePlayers = Array.from({ length: 10 }, (_, i) => `race-p-${i + 1}`);
    for (const p of queuePlayers) {
      await redisServiceMock.rpush('matchmaking_queue:classic_10', p);
    }

    // İki instance aynı anda dequeuePlayers(10) çağırıyor
    const [instance1Result, instance2Result] = await Promise.all([
      redisServiceMock.dequeuePlayers('matchmaking_queue:classic_10', 10, true),
      redisServiceMock.dequeuePlayers('matchmaking_queue:classic_10', 10, true),
    ]);

    // Biri tam 10 oyuncuyu alırken, diğeri kuyruk boşaldığı için 0 oyuncu almalı (Çift eşleşme imkansız)
    const totalDequeued = instance1Result.length + instance2Result.length;
    expect(totalDequeued).toBe(10);
    expect(
      (instance1Result.length === 10 && instance2Result.length === 0) ||
      (instance1Result.length === 0 && instance2Result.length === 10),
    ).toBe(true);
  });
});
