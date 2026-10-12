import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { GamesService } from './games.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { BotService } from '../bot/bot.service.js';
import { QuestionSelector } from './question-selector.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Server } from 'socket.io';

describe('10-Player Match & Acceptance Test Suite (Scenarios 1-8, 11-13)', () => {
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
  let socketServerMock: any;

  beforeEach(() => {
    // 1. Setup In-Memory Redis Mock
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
        redisStore.delete(key);
        return 1;
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

    // Seed game modes
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

    // Seed 20 Bots
    for (let i = 1; i <= 20; i++) {
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

    // Seed 50 Questions with QuestionVersion structure
    for (let i = 1; i <= 50; i++) {
      const type = i % 3 === 0 ? 'ESTIMATION' : i % 3 === 1 ? 'MULTIPLE_CHOICE' : 'RANKING';
      prismaStore.questions.push({
        id: `q-${i}`,
        code: `Q_${i}`,
        type,
        versions: [
          {
            versionNumber: 1,
            isActive: true,
            text: `Futbol Sorusu #${i}`,
            correctAnswer: type === 'ESTIMATION' ? 100 + i : type === 'MULTIPLE_CHOICE' ? 'A' : ['X', 'Y', 'Z'],
            metadata: {
              options: ['A', 'B', 'C', 'D'],
              items: ['X', 'Y', 'Z'],
              margin: 10,
            },
          },
        ],
      });
    }

    prismaServiceMock = {
      gameMode: {
        findUnique: vi.fn(async ({ where }) => prismaStore.gameModes.get(where.name) || null),
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
      },
      playerProfile: {
        findUnique: vi.fn(async ({ where }) => {
          const p = prismaStore.profiles.get(where.userId);
          return p ? { ...p } : null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const profile = prismaStore.profiles.get(where.userId);
          if (!profile) throw new Error('Profile not found');

          // Balance handling
          if (data.balance?.increment !== undefined) {
            profile.balance += data.balance.increment;
          } else if (data.balance?.decrement !== undefined) {
            profile.balance -= data.balance.decrement;
          } else if (typeof data.balance === 'number') {
            profile.balance = data.balance;
          }

          // HeldBalance handling
          if (data.heldBalance?.increment !== undefined) {
            profile.heldBalance += data.heldBalance.increment;
          } else if (data.heldBalance?.decrement !== undefined) {
            profile.heldBalance -= data.heldBalance.decrement;
          } else if (typeof data.heldBalance === 'number') {
            profile.heldBalance = data.heldBalance;
          }

          // Rating handling
          if (data.rating?.increment !== undefined) {
            profile.rating += data.rating.increment;
          } else if (typeof data.rating === 'number') {
            profile.rating = data.rating;
          }

          // Wins handling
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
          const match = { id, ...data, status: 'IN_PROGRESS', settledAt: null };
          prismaStore.matches.set(id, match);
          return match;
        }),
        findUnique: vi.fn(async ({ where }) => prismaStore.matches.get(where.id) || null),
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
      question: {
        findMany: vi.fn(async ({ where, select, include }) => {
          let list = prismaStore.questions;
          if (where?.id?.in) {
            list = list.filter((q) => where.id.in.includes(q.id));
          }
          if (select) {
            return list.map((q) => {
              const res: any = {};
              for (const k of Object.keys(select)) {
                res[k] = q[k];
              }
              return res;
            });
          }
          return list;
        }),
      },
      $queryRawUnsafe: vi.fn(async () => []),
      $transaction: vi.fn(async (cb) => cb(prismaServiceMock)),
    };

    // Socket server mock
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

  // Helper to create human user
  function createHuman(userId: string, name: string, balance = 1000) {
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

  describe('Scenario 1: 1 Real Player + 9 Bots Full 10-Round Match', () => {
    it('should complete matchmaking, 10 rounds of questions, and settle the match with 10 players', async () => {
      createHuman('human-1', 'Alperen', 500);

      // 1. Join queue
      await matchmakingService.joinQueue('human-1', 'classic_10');
      expect(prismaStore.profiles.get('human-1').balance).toBe(400);
      expect(prismaStore.profiles.get('human-1').heldBalance).toBe(100);

      // Verify queue has human-1
      const queueUsers = await redisServiceMock.lrange('matchmaking_queue:classic_10', 0, -1);
      expect(queueUsers).toContain('human-1');

      // 2. Trigger bot backfill for 9 bots
      const availableBots = (await prismaServiceMock.user.findMany({ where: { isBot: true } })).map((b: any) => b.id);
      const neededBots = 9;
      const selectedBots = availableBots.slice(0, neededBots);
      expect(selectedBots.length).toBe(9);

      // Start match with 1 human + 9 bots
      const allPlayers = ['human-1', ...selectedBots];
      expect(allPlayers.length).toBe(10);

      // Initialize room
      const roomId = 'room-scen1-10p';
      await matchmakingService.initializeRoom(roomId, allPlayers, 'classic_10');

      const roomDataRaw = await redisServiceMock.get(`room:${roomId}`);
      const roomData = JSON.parse(roomDataRaw);
      expect(roomData.players.length).toBe(10);
      expect(roomData.gameModeName).toBe('classic_10');
      expect(roomData.isPvE).toBe(true);
      expect(roomData.entryFee).toBe(0);

      // 3. Question generation: exactly 10 questions picked
      const questions = await QuestionSelector.selectRandomUniqueQuestions(
        prismaServiceMock as unknown as PrismaService,
        10,
      );
      expect(questions.length).toBe(10);
      // No duplicates
      const uniqueIds = new Set(questions.map((q) => q.questionId));
      expect(uniqueIds.size).toBe(10);

      // 4. Simulate 10 rounds
      roomData.questions = questions;
      roomData.status = 'PLAYING';

      for (let round = 0; round < 10; round++) {
        roomData.currentQuestionIndex = round;
        const currentQ = questions[round];

        // Each player answers
        for (const p of roomData.players) {
          if (p.userId === 'human-1') {
            // Human gives correct answer
            p.score = (p.score || 0) + 1000;
          } else {
            // Bot generates answer according to skill
            const answer = botService.generateBotAnswer(p.userId, currentQ);
            const isCorrect = answer === currentQ.correctAnswer;
            if (isCorrect) {
              p.score = (p.score || 0) + 800;
            }
          }
        }
      }

      await redisServiceMock.set(`room:${roomId}`, JSON.stringify(roomData));

      // 5. Finish game
      await gamesService.finishGame(roomId);

      // Human-1 should be the winner with 10,000 points in a PvE match
      const humanProfile = prismaStore.profiles.get('human-1');
      // Under Option C (PvE/Antrenman), bot-backfilled matches are free practice matches:
      // - The 100 coin heldEntryFee was refunded upon room creation
      // - Winner gets 0 coins and 0 rating change (no money minted out of thin air, no bot farming)
      expect(humanProfile.balance).toBe(500); // 400 + 100 refunded
      expect(humanProfile.heldBalance).toBe(0);
      expect(humanProfile.rating).toBe(1000); // unchanged
      expect(humanProfile.wins).toBe(0); // unchanged
    });
  });

  describe('Scenario 2: 4 Real Players + 6 Bots', () => {
    it('should form a 10-player room with 4 humans and 6 backfilled bots', async () => {
      for (let i = 1; i <= 4; i++) {
        createHuman(`human-${i}`, `Player ${i}`, 1000);
        await matchmakingService.joinQueue(`human-${i}`, 'classic_10');
      }

      const queue = await redisServiceMock.lrange('matchmaking_queue:classic_10', 0, -1);
      expect(queue.length).toBe(4);

      // Backfill 6 bots to reach 10 players
      const availableBots = (await prismaServiceMock.user.findMany({ where: { isBot: true } })).map((b: any) => b.id);
      const botsToAdd = availableBots.slice(0, 6);
      expect(botsToAdd.length).toBe(6);

      const matchPlayers = [...queue, ...botsToAdd];
      expect(matchPlayers.length).toBe(10);

      const roomId = 'room-scen2-4h-6b';
      await matchmakingService.initializeRoom(roomId, matchPlayers, 'classic_10');

      const roomData = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(roomData.players.filter((p: any) => !p.isBot).length).toBe(4);
      expect(roomData.players.filter((p: any) => p.isBot).length).toBe(6);
    });
  });

  describe('Scenario 3: 9 Real Players + 1 Bot', () => {
    it('should form a 10-player room with 9 humans and 1 backfilled bot', async () => {
      for (let i = 1; i <= 9; i++) {
        createHuman(`human-sc3-${i}`, `Player ${i}`, 1000);
        await matchmakingService.joinQueue(`human-sc3-${i}`, 'classic_10');
      }

      const queue = await redisServiceMock.lrange('matchmaking_queue:classic_10', 0, -1);
      expect(queue.length).toBe(9);

      const availableBots = (await prismaServiceMock.user.findMany({ where: { isBot: true } })).map((b: any) => b.id);
      const matchPlayers = [...queue, availableBots[0]];
      expect(matchPlayers.length).toBe(10);

      const roomId = 'room-scen3-9h-1b';
      await matchmakingService.initializeRoom(roomId, matchPlayers, 'classic_10');

      const roomData = JSON.parse(await redisServiceMock.get(`room:${roomId}`));
      expect(roomData.players.filter((p: any) => !p.isBot).length).toBe(9);
      expect(roomData.players.filter((p: any) => p.isBot).length).toBe(1);
    });
  });

  describe('Scenario 4: 10 Real Players (No Bots)', () => {
    it('should immediately form a 10-player room without any bots', async () => {
      for (let i = 1; i <= 10; i++) {
        createHuman(`human-sc4-${i}`, `Player ${i}`, 1000);
        await matchmakingService.joinQueue(`human-sc4-${i}`, 'classic_10');
      }

      // Room should have been triggered automatically when count reached 10
      const queueAfter = await redisServiceMock.lrange('matchmaking_queue:classic_10', 0, -1);
      expect(queueAfter.length).toBe(0); // Emptied into room

      // Check created rooms in redis
      const keys = Array.from(redisStore.keys()).filter((k) => k.startsWith('room:'));
      expect(keys.length).toBeGreaterThan(0);

      const latestRoom = JSON.parse(redisStore.get(keys[keys.length - 1]));
      expect(latestRoom.players.length).toBe(10);
      expect(latestRoom.players.every((p: any) => !p.isBot)).toBe(true);
    });
  });

  describe('Scenario 5: Concurrent Matchmaking Requests', () => {
    it('should handle 20 concurrent join requests without race conditions or duplicate entries', async () => {
      const promises: Promise<any>[] = [];
      for (let i = 1; i <= 20; i++) {
        const uid = `concurrent-user-${i}`;
        createHuman(uid, `Concurrent ${i}`, 500);
        promises.push(matchmakingService.joinQueue(uid, 'classic_10'));
      }

      await Promise.all(promises);

      // 20 players should cleanly create 2 rooms of 10 players, leaving 0 in queue
      const queue = await redisServiceMock.lrange('matchmaking_queue:classic_10', 0, -1);
      expect(queue.length).toBe(0);

      for (let i = 1; i <= 20; i++) {
        const uid = `concurrent-user-${i}`;
        expect(prismaStore.profiles.get(uid).balance).toBe(400);
        expect(prismaStore.profiles.get(uid).heldBalance).toBe(100);
        const playerRoom = await redisServiceMock.get(`player_room:${uid}`);
        expect(playerRoom).toBeDefined();
      }
    });
  });

  describe('Scenario 6: Queue Cancellation and Disconnect Handling', () => {
    it('should refund held fee and remove player from queue on cancellation', async () => {
      createHuman('canceller-1', 'Canceller', 500);
      await matchmakingService.joinQueue('canceller-1', 'classic_10');

      expect(prismaStore.profiles.get('canceller-1').balance).toBe(400);
      expect(prismaStore.profiles.get('canceller-1').heldBalance).toBe(100);

      // Leave queue
      await matchmakingService.leaveQueue('canceller-1', 'classic_10');

      // Assert refunded
      expect(prismaStore.profiles.get('canceller-1').balance).toBe(500);
      expect(prismaStore.profiles.get('canceller-1').heldBalance).toBe(0);

      const queue = await redisServiceMock.lrange('matchmaking_queue:classic_10', 0, -1);
      expect(queue).not.toContain('canceller-1');

      // Assert queue key cleared
      const playerQueue = await redisServiceMock.get('player_queue:canceller-1');
      expect(playerQueue).toBeNull();
    });

    it('should refund and cleanup on handleUserDisconnect', async () => {
      createHuman('dc-user-1', 'Disconnector', 500);
      await matchmakingService.joinQueue('dc-user-1', 'classic_10');

      // Simulate disconnect
      await matchmakingService.handleUserDisconnect('dc-user-1');

      expect(prismaStore.profiles.get('dc-user-1').balance).toBe(500);
      expect(prismaStore.profiles.get('dc-user-1').heldBalance).toBe(0);
      expect(await redisServiceMock.get('player_queue:dc-user-1')).toBeNull();
    });
  });

  describe('Scenario 7: Prevent Same Player from Entering Multiple Matches / Queues', () => {
    it('should reject joining a queue when already in another queue or room', async () => {
      createHuman('greedy-user', 'Greedy', 1000);
      await matchmakingService.joinQueue('greedy-user', 'classic_10');

      // Second join should fail
      await expect(matchmakingService.joinQueue('greedy-user', 'classic_10')).rejects.toThrow(
        /already in matchmaking queue/,
      );

      // When player is already in a room
      await redisServiceMock.set('player_room:greedy-user', 'room-123');
      await redisServiceMock.del('player_queue:greedy-user');

      await expect(matchmakingService.joinQueue('greedy-user', 'quick_2')).rejects.toThrow(
        /already in a game room/,
      );
    });
  });

  describe('Scenario 8: No Duplicate Questions in Same Match', () => {
    it('should guarantee that all 10 selected questions in any match are unique across 50 iterations', async () => {
      for (let run = 0; run < 50; run++) {
        const questions = await QuestionSelector.selectRandomUniqueQuestions(
          prismaServiceMock as unknown as PrismaService,
          10,
        );
        expect(questions.length).toBe(10);
        const idSet = new Set(questions.map((q) => q.questionId));
        expect(idSet.size).toBe(10);
      }
    });
  });

  describe('Scenario 11: Final Match Leaderboard & Correct Reward Distribution', () => {
    it('should rank 10 players descending, distribute 900 coins to winner and retain 100 house rake', async () => {
      const matchId = 'match-settle-test';
      const winnerId = 'winner-user';
      createHuman(winnerId, 'Champion', 0);
      prismaStore.profiles.get(winnerId).heldBalance = 100;

      const playerIds = [winnerId];
      for (let i = 2; i <= 10; i++) {
        const pid = `loser-${i}`;
        createHuman(pid, `Loser ${i}`, 0);
        prismaStore.profiles.get(pid).heldBalance = 100;
        playerIds.push(pid);
      }

      prismaStore.matches.set(matchId, {
        id: matchId,
        status: 'IN_PROGRESS',
        settledAt: null,
      });

      // Settle 10-player match
      await walletService.settleMatch(matchId, winnerId, 100, playerIds);

      // Winner gets 900 coins (1000 total - 100 house rake)
      const winnerProfile = prismaStore.profiles.get(winnerId);
      expect(winnerProfile.balance).toBe(900);
      expect(winnerProfile.heldBalance).toBe(0);
      expect(winnerProfile.rating).toBe(1020);
      expect(winnerProfile.wins).toBe(1);

      // All 10 players had their 100 heldBalance deducted
      for (const pid of playerIds) {
        expect(prismaStore.profiles.get(pid).heldBalance).toBe(0);
      }

      // Match status is SETTLED
      const match = prismaStore.matches.get(matchId);
      expect(match.status).toBe('SETTLED');
      expect(match.settledAt).toBeInstanceOf(Date);
    });
  });

  describe('Scenario 12: Entry Fee Hold, Cancellation & Settlement Idempotency', () => {
    it('should reject holdEntryFee if player has insufficient balance', async () => {
      createHuman('broke-user', 'Broke', 50);
      await expect(walletService.holdEntryFee('broke-user', 100)).rejects.toThrow('Bakiye yetersiz');
      expect(prismaStore.profiles.get('broke-user').balance).toBe(50);
      expect(prismaStore.profiles.get('broke-user').heldBalance).toBe(0);
    });

    it('should NOT credit double rewards if settleMatch is executed multiple times', async () => {
      const matchId = 'match-idempotent-test';
      const winnerId = 'lucky-winner';
      createHuman(winnerId, 'Winner', 100);
      prismaStore.profiles.get(winnerId).heldBalance = 100;

      prismaStore.matches.set(matchId, {
        id: matchId,
        status: 'IN_PROGRESS',
        settledAt: null,
      });

      // First call
      await walletService.settleMatch(matchId, winnerId, 100, [winnerId]);
      expect(prismaStore.profiles.get(winnerId).balance).toBe(190); // 100 + 90 prize
      expect(prismaStore.profiles.get(winnerId).rating).toBe(1020);

      // Second call (duplicate/retry)
      await walletService.settleMatch(matchId, winnerId, 100, [winnerId]);
      // Balance and rating MUST NOT increase a second time
      expect(prismaStore.profiles.get(winnerId).balance).toBe(190);
      expect(prismaStore.profiles.get(winnerId).rating).toBe(1020);
    });

    it('should reject double releaseHold if already released', async () => {
      createHuman('release-user', 'Rel', 100);
      await walletService.holdEntryFee('release-user', 100);
      expect(prismaStore.profiles.get('release-user').heldBalance).toBe(100);

      // 1st release
      await walletService.releaseHold('release-user', 100);
      expect(prismaStore.profiles.get('release-user').balance).toBe(100);
      expect(prismaStore.profiles.get('release-user').heldBalance).toBe(0);

      // 2nd release attempt
      await expect(walletService.releaseHold('release-user', 100)).rejects.toThrow();
    });

    it('should safely refund entry fee and be idempotent (no double payment on repeat calls)', async () => {
      createHuman('idempotent-refund-user', 'RefundTester', 500);
      await walletService.holdEntryFee('idempotent-refund-user', 100);
      expect(prismaStore.profiles.get('idempotent-refund-user').balance).toBe(400);
      expect(prismaStore.profiles.get('idempotent-refund-user').heldBalance).toBe(100);

      // 1st refund
      const firstRefund = await walletService.refundEntryFee('idempotent-refund-user', 100);
      expect(firstRefund).toBe(true);
      expect(prismaStore.profiles.get('idempotent-refund-user').balance).toBe(500);
      expect(prismaStore.profiles.get('idempotent-refund-user').heldBalance).toBe(0);

      // 2nd duplicate refund call
      const secondRefund = await walletService.refundEntryFee('idempotent-refund-user', 100);
      expect(secondRefund).toBe(false);
      // Balance must NOT double-credit
      expect(prismaStore.profiles.get('idempotent-refund-user').balance).toBe(500);
      expect(prismaStore.profiles.get('idempotent-refund-user').heldBalance).toBe(0);
    });

    it('should settle PvE bot match without deducting fees or minting unbacked coins/rating', async () => {
      const matchId = 'pve-bot-match-test';
      const humanWinner = 'human-winner-pve';
      createHuman(humanWinner, 'PvE Champion', 500);

      const botIds = ['bot-1', 'bot-2', 'bot-3'];
      const playerIds = [humanWinner, ...botIds];

      prismaStore.matches.set(matchId, {
        id: matchId,
        status: 'IN_PROGRESS',
        settledAt: null,
      });

      // Settle as PvE (either explicitly or detected via bot users in playerIds)
      await walletService.settleMatch(matchId, humanWinner, 100, playerIds, true);

      const winnerProfile = prismaStore.profiles.get(humanWinner);
      // Winner balance and rating must NOT change (0 coins, 0 rating, 0 wins)
      expect(winnerProfile.balance).toBe(500);
      expect(winnerProfile.heldBalance).toBe(0);
      expect(winnerProfile.rating).toBe(1000);
      expect(winnerProfile.wins).toBe(0);

      // No coin transaction created for PvE
      const pveTx = prismaStore.coinTransactions.find((tx: any) => tx.referenceId === matchId);
      expect(pveTx).toBeUndefined();

      // Match status must still be SETTLED
      const match = prismaStore.matches.get(matchId);
      expect(match.status).toBe('SETTLED');
      expect(match.settledAt).toBeInstanceOf(Date);
    });
  });

  describe('Scenario 13: Regression Test for 2-Player Mode (quick_2)', () => {
    it('should ensure quick_2 mode still runs with 2 players, 3 questions, and 180 coins prize', async () => {
      createHuman('q2-user1', 'Player 1', 500);
      createHuman('q2-user2', 'Player 2', 500);

      await matchmakingService.joinQueue('q2-user1', 'quick_2');
      await matchmakingService.joinQueue('q2-user2', 'quick_2');

      // quick_2 threshold is 2, queue should be emptied into room immediately
      const queue = await redisServiceMock.lrange('matchmaking_queue:quick_2', 0, -1);
      expect(queue.length).toBe(0);

      const keys = Array.from(redisStore.keys()).filter((k) => k.startsWith('room:'));
      const room = JSON.parse(redisStore.get(keys[keys.length - 1]));
      expect(room.players.length).toBe(2);
      expect(room.gameModeName).toBe('quick_2');

      // 3 questions selected
      const questions = await QuestionSelector.selectRandomUniqueQuestions(
        prismaServiceMock as unknown as PrismaService,
        3,
      );
      expect(questions.length).toBe(3);

      // Winner payout for 2 players @ 100 fee: total pot 200, rake 20, prize 180
      const matchId = 'match-q2-test';
      prismaStore.matches.set(matchId, { id: matchId, status: 'IN_PROGRESS', settledAt: null });
      await walletService.settleMatch(matchId, 'q2-user1', 100, ['q2-user1', 'q2-user2']);

      expect(prismaStore.profiles.get('q2-user1').balance).toBe(580); // 400 + 180
    });
  });
});
