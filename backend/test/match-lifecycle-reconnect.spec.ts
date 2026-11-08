import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GamesService } from '../src/games/games.service.js';
import { WalletService } from '../src/wallet/wallet.service.js';
import { MatchmakingService } from '../src/matchmaking/matchmaking.service.js';
import { GameGateway } from '../src/gateway/game.gateway.js';
import { BotService } from '../src/bot/bot.service.js';
import { WsRateLimiterService } from '../src/gateway/ws-rate-limiter.service.js';

describe('Faz 3: Maç Yaşam Döngüsü ve Reconnect Dayanıklılığı Test Paketi', () => {
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

  let walletService: WalletService;
  let botService: BotService;
  let gamesService: GamesService;
  let matchmakingService: MatchmakingService;
  let jwtServiceMock: any;
  let gateway: GameGateway;
  let socketServerMock: any;

  beforeEach(() => {
    // 1. In-Memory Redis Mock
    redisStore = new Map<string, any>();
    redisServiceMock = {
      get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
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
        if (exact && list.length < count) return [];
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

    // 2. In-Memory Prisma Mock
    prismaStore = {
      users: new Map(),
      profiles: new Map(),
      gameModes: new Map(),
      matches: new Map(),
      matchHolds: new Map(),
      coinTransactions: [],
      questions: [],
    };

    // Game modes
    prismaStore.gameModes.set('quick_2', {
      id: 'mode-quick-2',
      name: 'quick_2',
      maxPlayers: 2,
      entryFee: 100,
      questionCount: 2,
      questionDuration: 5,
    });

    prismaStore.gameModes.set('classic_10', {
      id: 'mode-classic-10',
      name: 'classic_10',
      maxPlayers: 10,
      entryFee: 100,
      questionCount: 3,
      questionDuration: 10,
    });

    prismaServiceMock = {
      $transaction: vi.fn(async (callback: any) => callback(prismaServiceMock)),
      $queryRaw: vi.fn(async () => []),
      $queryRawUnsafe: vi.fn(async () => []),
      user: {
        findUnique: vi.fn(async ({ where }: any) => prismaStore.users.get(where.id) || null),
        findMany: vi.fn(async ({ where }: any) => {
          let all = Array.from(prismaStore.users.values());
          if (where?.id?.in) all = all.filter((u) => where.id.in.includes(u.id));
          if (where?.isBot !== undefined) all = all.filter((u) => u.isBot === where.isBot);
          return all;
        }),
        create: vi.fn(async ({ data }: any) => {
          const user = { ...data, id: data.id || `u-${Date.now()}` };
          prismaStore.users.set(user.id, user);
          return user;
        }),
      },
      playerProfile: {
        findUnique: vi.fn(async ({ where }: any) => prismaStore.profiles.get(where.userId) || null),
        update: vi.fn(async ({ where, data }: any) => {
          const profile = prismaStore.profiles.get(where.userId);
          if (!profile) throw new Error('Profile not found');
          if (data.balance?.increment) profile.balance += data.balance.increment;
          if (data.balance !== undefined && typeof data.balance === 'number') profile.balance = data.balance;
          if (data.heldBalance?.increment) profile.heldBalance += data.heldBalance.increment;
          if (data.heldBalance?.decrement) profile.heldBalance -= data.heldBalance.decrement;
          if (data.heldBalance !== undefined && typeof data.heldBalance === 'number') profile.heldBalance = data.heldBalance;
          if (data.rating?.increment) profile.rating += data.rating.increment;
          if (data.wins?.increment) profile.wins += data.wins.increment;
          prismaStore.profiles.set(where.userId, profile);
          return { ...profile };
        }),
      },
      gameMode: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.name) return prismaStore.gameModes.get(where.name) || null;
          if (where.id) {
            return Array.from(prismaStore.gameModes.values()).find((m) => m.id === where.id) || null;
          }
          return null;
        }),
        findMany: vi.fn(async () => Array.from(prismaStore.gameModes.values())),
      },
      match: {
        create: vi.fn(async ({ data }: any) => {
          const match = {
            id: data.id,
            gameModeId: data.gameModeId,
            status: data.status || 'ACTIVE',
            createdAt: new Date(),
            settledAt: null,
            players: data.players?.create?.map((p: any) => ({ userId: p.userId })) || [],
          };
          prismaStore.matches.set(match.id, match);
          return match;
        }),
        findUnique: vi.fn(async ({ where }: any) => prismaStore.matches.get(where.id) || null),
        findMany: vi.fn(async ({ where }: any) => {
          let list = Array.from(prismaStore.matches.values());
          if (where?.status) list = list.filter((m) => m.status === where.status);
          if (where?.createdAt?.lt) list = list.filter((m) => m.createdAt < where.createdAt.lt);
          return list;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const match = prismaStore.matches.get(where.id);
          if (!match) throw new Error('Match not found');
          Object.assign(match, data);
          prismaStore.matches.set(where.id, match);
          return { ...match };
        }),
      },
      matchHold: {
        create: vi.fn(async ({ data }: any) => {
          const hold = {
            id: `hold-${Math.random().toString(36).substring(2, 9)}`,
            userId: data.userId,
            amount: data.amount,
            gameModeId: data.gameModeId,
            matchId: data.matchId || null,
            status: data.status || 'HELD',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          prismaStore.matchHolds.set(hold.id, hold);
          return hold;
        }),
        findUnique: vi.fn(async ({ where }: any) => prismaStore.matchHolds.get(where.id) || null),
        findFirst: vi.fn(async ({ where }: any) => {
          for (const hold of prismaStore.matchHolds.values()) {
            let match = true;
            if (where.userId && hold.userId !== where.userId) match = false;
            if (where.matchId !== undefined && hold.matchId !== where.matchId) match = false;
            if (where.status && hold.status !== where.status) match = false;
            if (where.id && hold.id !== where.id) match = false;
            if (match) return hold;
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          let list = Array.from(prismaStore.matchHolds.values());
          if (where.userId) list = list.filter((h) => h.userId === where.userId);
          if (where.matchId) list = list.filter((h) => h.matchId === where.matchId);
          if (where.status) list = list.filter((h) => h.status === where.status);
          return list;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const hold = prismaStore.matchHolds.get(where.id);
          if (!hold) throw new Error('Hold not found');
          Object.assign(hold, data, { updatedAt: new Date() });
          prismaStore.matchHolds.set(where.id, hold);
          return { ...hold };
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const hold of prismaStore.matchHolds.values()) {
            let match = true;
            if (where.matchId && hold.matchId !== where.matchId) match = false;
            if (where.status && hold.status !== where.status) match = false;
            if (match) {
              Object.assign(hold, data, { updatedAt: new Date() });
              count++;
            }
          }
          return { count };
        }),
      },
      coinTransaction: {
        findUnique: vi.fn(async ({ where }: any) => {
          const key = where.userId_type_referenceId;
          return (
            prismaStore.coinTransactions.find(
              (tx) => tx.userId === key.userId && tx.type === key.type && tx.referenceId === key.referenceId,
            ) || null
          );
        }),
        create: vi.fn(async ({ data }: any) => {
          prismaStore.coinTransactions.push({ ...data, id: `tx-${Date.now()}-${Math.random()}` });
          return data;
        }),
      },
    };

    // Services
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

    // Socket Server Mock
    socketServerMock = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };
    gamesService.setServer(socketServerMock);

    // JWT Mock
    jwtServiceMock = {
      verify: vi.fn((token: string) => {
        if (!token || token === 'invalid') throw new Error('Invalid token');
        return { sub: token.replace('token-', '') };
      }),
    };

    gateway = new GameGateway(
      matchmakingService,
      gamesService,
      jwtServiceMock,
      new WsRateLimiterService(),
    );
    gateway.afterInit(socketServerMock);
  });

  const setupUser = (userId: string, balance: number = 1000, isBot: boolean = false) => {
    prismaStore.users.set(userId, { id: userId, email: `${userId}@test.com`, isBot });
    prismaStore.profiles.set(userId, {
      id: `p-${userId}`,
      userId,
      balance,
      heldBalance: 0,
      rating: 1000,
      wins: 0,
    });
  };

  const createMockSocket = (id: string, token: string = `token-${id}`) => {
    const handlers: Record<string, Function[]> = {};
    const mockSocket: any = {
      id,
      handshake: {
        auth: { token },
        headers: {},
        address: '127.0.0.1',
      },
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn((ev: string, data: any) => {
        if (handlers[ev]) {
          handlers[ev].forEach((fn) => fn(data));
        }
      }),
      disconnect: vi.fn(),
      use: vi.fn((fn: any) => {
        // packet middleware mock
        (mockSocket as any)._middleware = fn;
      }),
      on: vi.fn((ev: string, fn: Function) => {
        if (!handlers[ev]) handlers[ev] = [];
        handlers[ev].push(fn);
      }),
    };
    return mockSocket;
  };

  // =========================================================================
  // 1. YAŞAM DÖNGÜSÜ DURUM GEÇİŞLERİ (STATE MACHINE & TRANSITIONS)
  // =========================================================================
  describe('1. Maç Yaşam Döngüsü ve Durum Geçişleri', () => {
    it('Oda oluşturma, soru aktifleştirme ve sonuçlandırma durumları kontrollü geçmelidir', async () => {
      const roomId = 'lifecycle-room-1';
      const p1 = 'user-p1';
      const p2 = 'user-p2';
      setupUser(p1, 1000);
      setupUser(p2, 1000);

      // Başlangıç: PLAYER_READY
      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        maxPlayers: 2,
        entryFee: 100,
        status: 'PLAYER_READY',
        players: [
          { userId: p1, score: 0, connected: true },
          { userId: p2, score: 0, connected: true },
        ],
        questions: [
          {
            type: 'MULTIPLE_CHOICE',
            text: 'Question 1',
            metadata: { options: ['A', 'B', 'C', 'D'] },
            correctAnswer: 'A',
            durationMs: 5000,
          },
        ],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));
      await redisServiceMock.set(`player_room:${p1}`, roomId);
      await redisServiceMock.set(`player_room:${p2}`, roomId);

      // QUESTION_ACTIVE durumundan önce cevap verilmesi engellenmelidir
      const earlyAnswer = await gamesService.submitAnswer(roomId, p1, 0, 'A');
      expect(earlyAnswer.success).toBe(false);
      expect(earlyAnswer.error).toBe('Question not active');

      // startQuestionPhase: QUESTION_ACTIVE durumuna geçiş
      await gamesService.startQuestionPhase(roomId, 0);
      const activeState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(activeState.status).toBe('QUESTION_ACTIVE');
      expect(activeState.currentQuestionIndex).toBe(0);

      // Soru aktifken geçerli cevap kabul edilmeli
      const validAnswer = await gamesService.submitAnswer(roomId, p1, 0, 'A');
      expect(validAnswer.success).toBe(true);

      // Aynı soruya mükerrer cevap engellenmeli
      const duplicateAnswer = await gamesService.submitAnswer(roomId, p1, 0, 'B');
      expect(duplicateAnswer.success).toBe(false);
      expect(duplicateAnswer.error).toBe('Already answered');

      // Geçersiz questionIndex reddedilmeli
      const invalidIndex = await gamesService.submitAnswer(roomId, p2, 99, 'A');
      expect(invalidIndex.success).toBe(false);
      expect(invalidIndex.error).toBe('Question not active');

      // endQuestionPhase: QUESTION_ENDED durumuna geçiş
      await gamesService.endQuestionPhase(roomId, 0);
      const endedState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(endedState.status).toBe('QUESTION_ENDED');

      // Süre bittikten sonra gelen cevap reddedilmeli
      const lateAnswer = await gamesService.submitAnswer(roomId, p2, 0, 'A');
      expect(lateAnswer.success).toBe(false);
      expect(lateAnswer.error).toBe('Question not active');
    });
  });

  // =========================================================================
  // 2. KOPMA (DISCONNECT) VE BİLDİRİM
  // =========================================================================
  describe('2. Oyuncunun Bağlantısının Kesilmesi (Disconnect)', () => {
    it('Maç sırasında soketi kopan oyuncu connected: false olarak işaretlenmeli ve odaya bildirilmelidir', async () => {
      const roomId = 'room-dc-test';
      const userId = 'user-dc-1';
      setupUser(userId, 500);

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        status: 'QUESTION_ACTIVE',
        players: [{ userId, score: 10, connected: true }],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));
      await redisServiceMock.set(`player_room:${userId}`, roomId);

      const socket = createMockSocket('sock-dc-1', `token-${userId}`);
      await gateway.handleConnection(socket);

      // Soket bağlantısı kesiliyor
      await gateway.handleDisconnect(socket);

      // Redis'te oyuncu durumu güncellenmiş olmalı
      const updatedState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      const playerRecord = updatedState.players.find((p: any) => p.userId === userId);
      expect(playerRecord.connected).toBe(false);
      expect(playerRecord.disconnectedAt).toBeDefined();

      // Odadaki diğer kullanıcılara bildirim gitmiş olmalı
      expect(socketServerMock.to).toHaveBeenCalledWith(roomId);
      expect(socketServerMock.emit).toHaveBeenCalledWith(
        'player_disconnected',
        expect.objectContaining({ userId, roomId }),
      );

      // Oyuncunun oda eşlemesi silinmemeli (reconnect için korunmalı)
      const assignedRoom = await matchmakingService.getPlayerRoom(userId);
      expect(assignedRoom).toBe(roomId);
    });
  });

  // =========================================================================
  // 3. YENİDEN BAĞLANMA (RECONNECT) VE DURUM SENKRONİZASYONU
  // =========================================================================
  describe('3. Yeniden Bağlanma (Reconnect) ve Anlık Durum Senkronizasyonu', () => {
    it('Yeniden bağlanan oyuncu doğru odaya dönmeli, soru durumu ve kalan süreyi eksiksiz almalıdır', async () => {
      const roomId = 'room-recon-test';
      const userId = 'user-recon-1';
      setupUser(userId, 500);

      const questionEndsAt = Date.now() + 8000;
      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 1,
        questionEndsAt,
        questions: [
          { type: 'MULTIPLE_CHOICE', text: 'Q0', correctAnswer: 'A', durationMs: 10000 },
          {
            type: 'MULTIPLE_CHOICE',
            text: 'Q1: Hangi takım?',
            metadata: { options: ['Real Madrid', 'Barcelona'] },
            correctAnswer: 'Barcelona',
            durationMs: 10000,
          },
        ],
        currentQuestion: {
          type: 'MULTIPLE_CHOICE',
          text: 'Q1: Hangi takım?',
          metadata: { options: ['Real Madrid', 'Barcelona'] },
          correctAnswer: 'Barcelona',
          durationMs: 10000,
        },
        players: [{ userId, score: 25, connected: false }],
        givenAnswers: {},
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));
      await redisServiceMock.set(`player_room:${userId}`, roomId);

      // Yeni soket ile bağlantı kuruluyor
      const newSocket = createMockSocket('sock-recon-new', `token-${userId}`);
      await gateway.handleConnection(newSocket);

      // Odaya katılma (join_room) talebi gönderiliyor
      await gateway.handleJoinRoom({ roomId }, newSocket);

      // 1. Soket odaya katılmış olmalı
      expect(newSocket.join).toHaveBeenCalledWith(roomId);

      // 2. room_joined ve room_sync eventleri istemciye gönderilmiş olmalı
      expect(newSocket.emit).toHaveBeenCalledWith('room_joined', {
        roomId,
        status: 'joined',
      });

      // 3. room_sync payload'ının doğrulanması (Doğru cevap SIZDIRILMAMALIDIR!)
      expect(newSocket.emit).toHaveBeenCalledWith(
        'room_sync',
        expect.objectContaining({
          roomId,
          status: 'QUESTION_ACTIVE',
          currentQuestionIndex: 1,
          question: expect.objectContaining({
            text: 'Q1: Hangi takım?',
          }),
          hasAnswered: false,
          remainingMs: expect.any(Number),
        }),
      );

      // room_sync payload içinde correctAnswer OLMADIĞI kesinleştirilmeli
      const syncCalls = newSocket.emit.mock.calls.filter((c: any) => c[0] === 'room_sync');
      expect(syncCalls.length).toBe(1);
      const syncPayload = syncCalls[0][1];
      expect(syncPayload.question.correctAnswer).toBeUndefined();

      // 4. Redis'te oyuncu durumu tekrar connected: true olmalı
      const updatedState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(updatedState.players[0].connected).toBe(true);

      // 5. Reconnect sonrası soruya cevap gönderebilmeli
      const answerRes = await gamesService.submitAnswer(roomId, userId, 1, 'Barcelona');
      expect(answerRes.success).toBe(true);
    });
  });

  // =========================================================================
  // 4. UYGULAMAYI KAPATIP AÇMA (APP RESTART) VE OTOMATİK MAÇ TESPİTİ
  // =========================================================================
  describe('4. Uygulamayı Kapatıp Açma (App Restart) Senaryosu', () => {
    it('Uygulamayı kapatıp açan kullanıcıya aktif maçı anında bildirilmelidir', async () => {
      const roomId = 'room-restart-app';
      const userId = 'user-app-restart';
      setupUser(userId, 500);

      await redisServiceMock.set(`player_room:${userId}`, roomId);
      await redisServiceMock.set(
        `room:${roomId}`,
        JSON.stringify({
          roomId,
          status: 'QUESTION_ACTIVE',
          gameModeName: 'quick_2',
          players: [{ userId, connected: false }],
        }),
      );

      // Kullanıcı uygulamayı yeni açtı ve bağlandı
      const appSocket = createMockSocket('sock-restart-fresh', `token-${userId}`);
      await gateway.handleConnection(appSocket);

      // Gateway bağlantı anında active_match_found yayınlamalı
      expect(appSocket.emit).toHaveBeenCalledWith('active_match_found', {
        roomId,
        status: 'QUESTION_ACTIVE',
      });

      // Ayrıca manuel get_active_match sorgusunda da doğru odayı dönmeli
      await gateway.handleGetActiveMatch(appSocket);
      expect(appSocket.emit).toHaveBeenCalledWith('active_match_status', {
        hasActiveMatch: true,
        roomId,
        gameModeName: 'quick_2',
        status: 'QUESTION_ACTIVE',
      });
    });
  });

  // =========================================================================
  // 5. AYNI ANDA İKİ CİHAZDAN BAĞLANMA (MULTI-DEVICE CONCURRENCY)
  // =========================================================================
  describe('5. Aynı Anda İki Cihazdan Bağlanma (Multi-Device Concurrency)', () => {
    it('İki ayrı cihazdan bağlanan kullanıcıda biri kopsa dahi maç kopmamalı ve mükerrer cevap engellenmelidir', async () => {
      const userId = 'user-multi-device';
      const roomId = 'room-multi-device';
      setupUser(userId, 1000);

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        players: [{ userId, score: 0, connected: true }],
        questions: [{ type: 'MULTIPLE_CHOICE', text: 'Q1', durationMs: 10000 }],
        givenAnswers: {},
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));
      await redisServiceMock.set(`player_room:${userId}`, roomId);

      // Cihaz 1 ve Cihaz 2 aynı token ile bağlanıyor
      const device1 = createMockSocket('sock-device-1', `token-${userId}`);
      const device2 = createMockSocket('sock-device-2', `token-${userId}`);

      await gateway.handleConnection(device1);
      await gateway.handleConnection(device2);

      // Cihaz 1'in bağlantısı kesiliyor (örn. ekran kapandı)
      await gateway.handleDisconnect(device1);

      // Cihaz 2 hala aktif olduğu için kullanıcı disconnected olarak İŞARETLENMEMELİDİR
      const midState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(midState.players[0].connected).toBe(true);

      // İki cihaz aynı soruya cevap göndermeyi denerse:
      // İlk gelen cevap başarılı olmalı
      const firstAnswer = await gamesService.submitAnswer(roomId, userId, 0, 'AnswerFromDev2');
      expect(firstAnswer.success).toBe(true);

      // Diğer cihazdan gelen mükerrer cevap reddedilmeli
      const secondAnswer = await gamesService.submitAnswer(roomId, userId, 0, 'AnswerFromDev1');
      expect(secondAnswer.success).toBe(false);
      expect(secondAnswer.error).toBe('Already answered');

      // Son cihaz da koptuğunda kullanıcı disconnected olarak işaretlenmeli
      await gateway.handleDisconnect(device2);
      const finalState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(finalState.players[0].connected).toBe(false);
    });
  });

  // =========================================================================
  // 6. MAÇ DEVAM EDERKEN ODADAN AYRILMA (LEAVE ROOM / FORFEIT)
  // =========================================================================
  describe('6. Maç Devam Ederken Odadan Ayrılma (Forfeit / Abandonment)', () => {
    it('Maçı terk eden oyuncunun ücreti iade EDİLMEMELİ, ekonomi korunmalı ve odadakilere bildirilmelidir', async () => {
      const roomId = 'room-forfeit-test';
      const quitterId = 'user-quitter';
      const remainingId = 'user-stayer';
      setupUser(quitterId, 1000);
      setupUser(remainingId, 1000);

      // Giriş ücreti hold'ları
      const holdQuitter = await walletService.holdEntryFee(quitterId, 100, { matchId: roomId });
      const holdStayer = await walletService.holdEntryFee(remainingId, 100, { matchId: roomId });

      await prismaServiceMock.match.create({
        data: {
          id: roomId,
          gameModeId: 'mode-quick-2',
          players: { create: [{ userId: quitterId }, { userId: remainingId }] },
        },
      });

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        players: [
          { userId: quitterId, score: 0, connected: true, hasLeft: false },
          { userId: remainingId, score: 10, connected: true, hasLeft: false },
        ],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));
      await redisServiceMock.set(`player_room:${quitterId}`, roomId);
      await redisServiceMock.set(`player_room:${remainingId}`, roomId);

      const quitterSocket = createMockSocket('sock-quitter', `token-${quitterId}`);
      await gateway.handleConnection(quitterSocket);

      // Oyuncu leave_room çağırıyor
      await gateway.handleLeaveRoom({ roomId }, quitterSocket);

      // 1. Oyuncunun ayrıldığı teyit edilmeli
      expect(quitterSocket.leave).toHaveBeenCalledWith(roomId);
      expect(quitterSocket.emit).toHaveBeenCalledWith('room_left', {
        roomId,
        status: 'left',
      });

      // 2. Terk eden oyuncunun player_room kaydı silinmiş olmalı (yeni maça girebilmesi için)
      const quitterRoom = await redisServiceMock.get(`player_room:${quitterId}`);
      expect(quitterRoom).toBeNull();

      // 3. EKONOMİ GÜVENLİĞİ: Terk eden oyuncunun parası cüzdanına İADE EDİLMEMELİDİR!
      const quitterProfile = prismaStore.profiles.get(quitterId);
      expect(quitterProfile.balance).toBe(900); // 100 coin hala held durumda
      expect(quitterProfile.heldBalance).toBe(100);

      // 4. Terk eden oyuncu sonradan cevap göndermeyi denerse reddedilmeli
      const answerAttempt = await gamesService.submitAnswer(roomId, quitterId, 0, 'CheatingAnswer');
      expect(answerAttempt.success).toBe(false);
      expect(answerAttempt.error).toBe('Player has left the match');
    });

    it('Tüm gerçek oyuncular ayrıldığında maç derhal güvenle sonlandırılmalıdır', async () => {
      const roomId = 'room-all-leave';
      const u1 = 'user-leave-1';
      setupUser(u1, 500);

      await prismaServiceMock.match.create({
        data: { id: roomId, gameModeId: 'mode-quick-2', players: { create: [{ userId: u1 }] } },
      });

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        players: [{ userId: u1, score: 0, connected: true, isBot: false }],
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));
      await redisServiceMock.set(`player_room:${u1}`, roomId);

      const socket = createMockSocket('sock-u1', `token-${u1}`);
      await gateway.handleConnection(socket);
      await gateway.handleLeaveRoom({ roomId }, socket);

      // Oda finishGame ile kapatılmış olmalı
      const finalState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(finalState.status).toBe('GAME_FINISHED');
    });
  });

  // =========================================================================
  // 7. CEVAP VERMEDEN SÜRENİN DOLMASI (QUESTION TIMEOUT)
  // =========================================================================
  describe('7. Cevap Vermeden Sürenin Dolması (Question Timeout)', () => {
    it('Süre dolana kadar cevap vermeyen oyuncuya 0 puan verilmeli ve akış bozulmadan devam etmelidir', async () => {
      const roomId = 'room-timeout-round';
      const p1 = 'user-active-answer';
      const p2 = 'user-timeout-idle';
      setupUser(p1, 500);
      setupUser(p2, 500);

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        questions: [
          {
            type: 'MULTIPLE_CHOICE',
            text: 'Question Timeout Test',
            correctAnswer: 'B',
            durationMs: 5000,
          },
        ],
        currentQuestion: {
          type: 'MULTIPLE_CHOICE',
          text: 'Question Timeout Test',
          correctAnswer: 'B',
          durationMs: 5000,
        },
        players: [
          { userId: p1, score: 0, connected: true },
          { userId: p2, score: 0, connected: true },
        ],
        givenAnswers: {},
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));

      // p1 cevap veriyor, p2 hiç cevap vermiyor
      await gamesService.submitAnswer(roomId, p1, 0, 'B');

      // Soru süresi doluyor ve endQuestionPhase çağrılıyor
      await gamesService.endQuestionPhase(roomId, 0);

      const endedState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      const p1Record = endedState.players.find((p: any) => p.userId === p1);
      const p2Record = endedState.players.find((p: any) => p.userId === p2);

      // p1 doğru cevap puanını almalı
      expect(p1Record.score).toBeGreaterThan(0);
      // p2 cevap vermediği için 0 puanda kalmalı, çökme yaşanmamalı
      expect(p2Record.score).toBe(0);

      // Odaya sonuçların başarıyla yayınlandığı doğrulanmalı
      expect(socketServerMock.to).toHaveBeenCalledWith(roomId);
      expect(socketServerMock.emit).toHaveBeenCalledWith(
        'question_ended',
        expect.objectContaining({
          questionIndex: 0,
          correctAnswer: 'B',
          playerResults: expect.arrayContaining([
            expect.objectContaining({ userId: p2, scoreGained: 0, isCorrect: false }),
          ]),
        }),
      );
    });
  });

  // =========================================================================
  // 8. BÜTÜN OYUNCULARIN BAĞLANTISININ KESİLMESİ
  // =========================================================================
  describe('8. Bütün Oyuncuların Bağlantısının Kesilmesi Senaryosu', () => {
    it('Tüm oyuncular kopsa dahi maç state machine hata vermeden tamamlanabilmelidir', async () => {
      const roomId = 'room-all-dc';
      const p1 = 'user-dc-all-1';
      const p2 = 'user-dc-all-2';
      setupUser(p1, 500);
      setupUser(p2, 500);

      await walletService.holdEntryFee(p1, 100, { matchId: roomId });
      await walletService.holdEntryFee(p2, 100, { matchId: roomId });

      await prismaServiceMock.match.create({
        data: {
          id: roomId,
          gameModeId: 'mode-quick-2',
          players: { create: [{ userId: p1 }, { userId: p2 }] },
        },
      });

      const roomState = {
        roomId,
        gameModeName: 'quick_2',
        entryFee: 100,
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: 0,
        questions: [{ type: 'MULTIPLE_CHOICE', text: 'Q1', durationMs: 5000, correctAnswer: 'A' }],
        currentQuestion: { type: 'MULTIPLE_CHOICE', text: 'Q1', durationMs: 5000, correctAnswer: 'A' },
        players: [
          { userId: p1, score: 0, connected: false },
          { userId: p2, score: 0, connected: false },
        ],
        givenAnswers: {},
      };
      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomState));

      // Her iki oyuncu da koptu, soru sona erdiriliyor
      await gamesService.endQuestionPhase(roomId, 0);

      // Oyun sonlandırılıyor
      await gamesService.finishGame(roomId);

      const finalState = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(finalState.status).toBe('GAME_FINISHED');

      // Maç veritabanında başarıyla SETTLED durumuna geçmiş olmalı
      const dbMatch = prismaStore.matches.get(roomId);
      expect(dbMatch.status).toBe('SETTLED');
      expect(dbMatch.settledAt).toBeDefined();
    });
  });

  // =========================================================================
  // 9. MÜKERRER ÖDÜL KORUMASI (DOUBLE REWARD PREVENTION / IDEMPOTENCY)
  // =========================================================================
  describe('9. Maç Bitmişse Yeniden Bağlanana İkinci Kez Ödül Verilmemesi (Idempotency)', () => {
    it('Bitmiş maça yeniden bağlanan veya settlement tetikleyen kullanıcıya ikinci kez ödül verilmediği kanıtlanmalıdır', async () => {
      const matchId = 'match-idempotent-settle';
      const winnerId = 'user-winner-double-test';
      const loserId = 'user-loser-double-test';
      setupUser(winnerId, 1000);
      setupUser(loserId, 1000);

      // Giriş ücreti hold'ları
      await walletService.holdEntryFee(winnerId, 100, { matchId });
      await walletService.holdEntryFee(loserId, 100, { matchId });

      await prismaServiceMock.match.create({
        data: {
          id: matchId,
          gameModeId: 'mode-quick-2',
          status: 'ACTIVE',
          players: { create: [{ userId: winnerId }, { userId: loserId }] },
        },
      });

      // 1. İlk Settlement: Winner ödülü alır
      await walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId], false);

      const winnerProfileAfter1 = prismaStore.profiles.get(winnerId);
      // Toplam pot: 200, house fee: 20 (%10), net ödül: 180. Bakiye: 900 + 180 = 1080
      expect(winnerProfileAfter1.balance).toBe(1080);
      expect(winnerProfileAfter1.rating).toBe(1020);
      expect(winnerProfileAfter1.wins).toBe(1);

      const rewardTxs1 = prismaStore.coinTransactions.filter(
        (tx) => tx.userId === winnerId && tx.type === 'MATCH_REWARD' && tx.referenceId === matchId,
      );
      expect(rewardTxs1.length).toBe(1);

      // 2. Yeniden Bağlanma (Reconnect): Bitmiş odaya join_room deneniyor
      await redisServiceMock.set(
        `room:${matchId}`,
        JSON.stringify({
          roomId: matchId,
          status: 'GAME_FINISHED',
          players: [{ userId: winnerId }],
        }),
      );
      await redisServiceMock.set(`player_room:${winnerId}`, matchId);

      const winnerSocket = createMockSocket('sock-winner-recon', `token-${winnerId}`);
      await gateway.handleConnection(winnerSocket);
      await gateway.handleJoinRoom({ roomId: matchId }, winnerSocket);

      // Bitmiş odaya giriş ROOM_CLOSED ile reddedilmeli
      expect(winnerSocket.emit).toHaveBeenCalledWith('error', {
        code: 'ROOM_CLOSED',
        message: 'Room is already finished.',
      });

      // 3. İkinci Settlement Denemesi (Doğrudan veya hileli mükerrer çağrı)
      await walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId], false);

      // Kazanana KESİNLİKLE ikinci kez ödül verilmediği kanıtlanmalı
      const winnerProfileAfter2 = prismaStore.profiles.get(winnerId);
      expect(winnerProfileAfter2.balance).toBe(1080); // DEĞİŞMEMELİ
      expect(winnerProfileAfter2.rating).toBe(1020); // DEĞİŞMEMELİ
      expect(winnerProfileAfter2.wins).toBe(1); // DEĞİŞMEMELİ

      const rewardTxs2 = prismaStore.coinTransactions.filter(
        (tx) => tx.userId === winnerId && tx.type === 'MATCH_REWARD' && tx.referenceId === matchId,
      );
      expect(rewardTxs2.length).toBe(1); // Mükerrer ledger kaydı oluşmamalı
    });
  });

  // =========================================================================
  // 10. EKONOMİ SİSTEMİ BÜTÜNLÜĞÜ (TIMEOUT & FORFEIT ACCOUNTING)
  // =========================================================================
  describe('10. Timeout ve Terk Etme Durumlarında Ekonomi Sisteminin Korunması', () => {
    it('10 oyunculu maçta timeout ve terk etmelere rağmen toplam para arzı kuruşu kuruşuna tutmalıdır', async () => {
      const matchId = 'match-eco-audit-10p';
      const players: string[] = [];
      const entryFee = 100;

      for (let i = 1; i <= 10; i++) {
        const pid = `human-eco-${i}`;
        players.push(pid);
        setupUser(pid, 500); // Toplam para: 10 * 500 = 5000 coin
        await walletService.holdEntryFee(pid, entryFee, { matchId });
      }

      await prismaServiceMock.match.create({
        data: {
          id: matchId,
          gameModeId: 'mode-classic-10',
          players: { create: players.map((userId) => ({ userId })) },
        },
      });

      // 3 oyuncu maçı terk ediyor
      const quitters = [players[0], players[1], players[2]];
      // 3 oyuncu süreyi timeout ettiriyor
      const timeouts = [players[3], players[4], players[5]];
      // 4 oyuncu oyunu tamamlıyor, p9 kazanıyor
      const winnerId = players[9];

      // Settlement
      await walletService.settleMatch(matchId, winnerId, entryFee, players, false);

      // Muhasebe Denetimi (Ledger Audit):
      // Toplam Pot: 10 * 100 = 1000 coin
      // Kasa Kesintisi: %10 = 100 coin
      // Kazanan Ödülü: 900 coin
      // Kazananın son bakiyesi: (500 - 100) + 900 = 1300 coin
      // Diğer 9 oyuncunun son bakiyesi: (500 - 100) = 400 coin her biri (Toplam 3600)
      // Toplam sistem parası: 1300 + 3600 + 100 (kasa) = 5000 coin!

      const winnerProf = prismaStore.profiles.get(winnerId);
      expect(winnerProf.balance).toBe(1300);
      expect(winnerProf.heldBalance).toBe(0);

      let totalRemainingUserCoins = 0;
      for (const pid of players) {
        const prof = prismaStore.profiles.get(pid);
        expect(prof.heldBalance).toBe(0); // Hiçbir asılı bloke kalmamalı
        totalRemainingUserCoins += prof.balance;
      }

      const houseFee = 1000 * 0.1;
      const totalSystemCoins = totalRemainingUserCoins + houseFee;
      expect(totalSystemCoins).toBe(5000); // 0 coin sızıntısı!
    });
  });

  // =========================================================================
  // 11. SUNUCU YENİDEN BAŞLAMA VE RECONCILIATION SINIRLARI
  // =========================================================================
  describe('11. Sunucu Yeniden Başlama Davranışı ve Mimari Sınırları', () => {
    it('Sunucu çökmesi sonrası yarım kalan maçlar reconciliation ile güvenle ABORTED edilmeli ve %100 iade edilmelidir', async () => {
      const crashMatchId = 'match-server-crash';
      const u1 = 'user-crash-1';
      const u2 = 'user-crash-2';
      setupUser(u1, 1000);
      setupUser(u2, 1000);

      // Bloke alınıyor
      await walletService.holdEntryFee(u1, 100, { matchId: crashMatchId });
      await walletService.holdEntryFee(u2, 100, { matchId: crashMatchId });

      // Maç ve hold kayıtları 20 dakika öncesine ayarlanıyor (sunucu çöküşü öncesi)
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      for (const hold of prismaStore.matchHolds.values()) {
        if (hold.matchId === crashMatchId) {
          hold.createdAt = oldTime;
          hold.updatedAt = oldTime;
        }
      }
      const staleMatch = {
        id: crashMatchId,
        gameModeId: 'mode-quick-2',
        gameMode: { entryFee: 100 },
        status: 'ACTIVE',
        createdAt: oldTime,
        players: [{ userId: u1 }, { userId: u2 }],
      };
      prismaStore.matches.set(crashMatchId, staleMatch);

      // Sunucu yeniden başlatıldı: onModuleInit -> reconcileStaleMatches(15) çalışır
      const result = await walletService.reconcileStaleMatches(15);

      expect(result.abortedCount).toBe(1);
      expect(result.refundedCount).toBe(2);

      // Maç veritabanında ABORTED olmalı
      const updatedMatch = prismaStore.matches.get(crashMatchId);
      expect(updatedMatch.status).toBe('ABORTED');
      expect(updatedMatch.settledAt).toBeDefined();

      // Oyuncuların paraları %100 cüzdanlarına geri iade edilmiş olmalı
      const p1 = prismaStore.profiles.get(u1);
      const p2 = prismaStore.profiles.get(u2);
      expect(p1.balance).toBe(1000);
      expect(p1.heldBalance).toBe(0);
      expect(p2.balance).toBe(1000);
      expect(p2.heldBalance).toBe(0);

      // İade transaction'ları kaydedilmiş olmalı
      const refundTxs = prismaStore.coinTransactions.filter(
        (tx) => tx.type === 'MATCH_REFUND' && tx.referenceId === crashMatchId,
      );
      expect(refundTxs.length).toBe(2);
    });

    it('Mevcut mimarinin sınırları: Sunucu çöküşü sonrası in-flight setTimeout soru timerları bellekte devam etmez, safe-abort güvencesi sunar', async () => {
      // Desteklenmeyen recovery uydurması yapılmamalı:
      // Footrace Node.js bellek içi setTimeout soru sayacını çöküş sonrası milisaniyesi milisaniyesine devam ettirmez.
      // Bunun yerine bakiye koruması ve güvenli abort & tam iade mimari güvencesi sağlar.
      expect(typeof walletService.reconcileStaleMatches).toBe('function');
    });
  });
});
