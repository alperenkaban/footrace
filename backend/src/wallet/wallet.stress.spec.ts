import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

interface ProfileState {
  userId: string;
  balance: number;
  heldBalance: number;
  rating: number;
  wins: number;
  losses: number;
}

interface HoldState {
  id: string;
  userId: string;
  matchId: string | null;
  gameModeId: string | null;
  amount: number;
  status: 'HELD' | 'REFUNDED' | 'SETTLED';
  createdAt: Date;
  updatedAt: Date;
  refundedAt: Date | null;
  settledAt: Date | null;
}

interface CoinTxState {
  id: string;
  userId: string;
  amount: number;
  type: string;
  referenceId: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
}

interface MatchState {
  id: string;
  gameModeId: string;
  status: string;
  settledAt: Date | null;
  createdAt: Date;
  players?: any[];
}

// Deadlock-free FIFO Keyed Mutex for simulating PostgreSQL FOR UPDATE row locks
class KeyedMutex {
  private queues = new Map<string, Promise<void>>();

  async lock(key: string): Promise<() => void> {
    const currentLock = this.queues.get(key) || Promise.resolve();
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.queues.set(
      key,
      currentLock.then(() => nextLock),
    );

    await currentLock;
    return () => {
      release();
    };
  }
}

describe('Ekonomi ve Cüzdan Stres Testleri (Faz 0 — WalletService, MatchHold, CoinTransaction)', () => {
  let profiles: Map<string, ProfileState>;
  let users: Map<string, any>;
  let matches: Map<string, MatchState>;
  let matchHolds: Map<string, HoldState>;
  let coinTransactions: CoinTxState[];
  let queryRawLogs: string[];
  let keyedMutex: KeyedMutex;

  let prismaServiceMock: any;
  let walletService: WalletService;

  function createTestUser(userId: string, balance = 1000, isBot = false) {
    users.set(userId, { id: userId, email: `${userId}@test.local`, isBot });
    profiles.set(userId, {
      userId,
      balance,
      heldBalance: 0,
      rating: 1000,
      wins: 0,
      losses: 0,
    });
  }

  beforeEach(() => {
    profiles = new Map();
    users = new Map();
    matches = new Map();
    matchHolds = new Map();
    coinTransactions = [];
    queryRawLogs = [];
    keyedMutex = new KeyedMutex();

    const dbClient = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        const rawSql = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''), '');
        queryRawLogs.push(rawSql);
        return [];
      }),
      $queryRawUnsafe: vi.fn(async (sql: string, ...values: any[]) => {
        const formatted = `${sql} [${values.join(', ')}]`;
        queryRawLogs.push(formatted);
        return [];
      }),
      playerProfile: {
        findUnique: vi.fn(async ({ where }) => {
          const p = profiles.get(where.userId);
          return p ? { ...p } : null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const p = profiles.get(where.userId);
          if (!p) throw new Error(`PlayerProfile ${where.userId} not found`);

          if (data.balance?.increment !== undefined) p.balance += data.balance.increment;
          else if (data.balance?.decrement !== undefined) p.balance -= data.balance.decrement;
          else if (typeof data.balance === 'number') p.balance = data.balance;

          if (data.heldBalance?.increment !== undefined) p.heldBalance += data.heldBalance.increment;
          else if (data.heldBalance?.decrement !== undefined) p.heldBalance -= data.heldBalance.decrement;
          else if (typeof data.heldBalance === 'number') p.heldBalance = data.heldBalance;

          if (data.rating?.increment !== undefined) p.rating += data.rating.increment;
          if (data.wins?.increment !== undefined) p.wins += data.wins.increment;
          if (data.losses?.increment !== undefined) p.losses += data.losses.increment;

          return { ...p };
        }),
      },
      matchHold: {
        create: vi.fn(async ({ data }) => {
          const id = data.id || `hold-${Math.random().toString(36).substring(2, 9)}`;
          const hold: HoldState = {
            id,
            userId: data.userId,
            matchId: data.matchId || null,
            gameModeId: data.gameModeId || null,
            amount: data.amount,
            status: data.status || 'HELD',
            createdAt: new Date(),
            updatedAt: new Date(),
            refundedAt: null,
            settledAt: null,
          };
          matchHolds.set(id, hold);
          return { ...hold };
        }),
        findUnique: vi.fn(async ({ where }) => {
          const h = matchHolds.get(where.id);
          return h ? { ...h } : null;
        }),
        findFirst: vi.fn(async ({ where, orderBy }) => {
          let list = Array.from(matchHolds.values());
          if (where?.id) list = list.filter((h) => h.id === where.id);
          if (where?.userId) list = list.filter((h) => h.userId === where.userId);
          if (where?.matchId !== undefined) list = list.filter((h) => h.matchId === where.matchId);
          if (where?.status) list = list.filter((h) => h.status === where.status);
          if (orderBy?.createdAt === 'desc') {
            list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return list.length > 0 ? { ...list[0] } : null;
        }),
        findMany: vi.fn(async ({ where }) => {
          let list = Array.from(matchHolds.values());
          if (where?.matchId !== undefined) list = list.filter((h) => h.matchId === where.matchId);
          if (where?.userId) {
            if (where.userId.in) list = list.filter((h) => where.userId.in.includes(h.userId));
            else list = list.filter((h) => h.userId === where.userId);
          }
          if (where?.status) list = list.filter((h) => h.status === where.status);
          return list.map((h) => ({ ...h }));
        }),
        update: vi.fn(async ({ where, data }) => {
          const h = matchHolds.get(where.id);
          if (!h) throw new Error(`MatchHold ${where.id} not found`);
          Object.assign(h, data);
          h.updatedAt = new Date();
          return { ...h };
        }),
      },
      coinTransaction: {
        findUnique: vi.fn(async ({ where }) => {
          if (where?.userId_type_referenceId) {
            const { userId, type, referenceId } = where.userId_type_referenceId;
            const found = coinTransactions.find(
              (tx) => tx.userId === userId && tx.type === type && tx.referenceId === referenceId,
            );
            return found ? { ...found } : null;
          }
          return null;
        }),
        create: vi.fn(async ({ data }) => {
          const duplicate = coinTransactions.find(
            (tx) => tx.userId === data.userId && tx.type === data.type && tx.referenceId === data.referenceId,
          );
          if (duplicate) {
            throw new Error('P2002: Unique constraint failed on fields: (userId, type, referenceId)');
          }
          const record: CoinTxState = {
            id: `tx-${Math.random().toString(36).substring(2, 9)}`,
            ...data,
            createdAt: new Date(),
          };
          coinTransactions.push(record);
          return { ...record };
        }),
        findMany: vi.fn(async ({ where }) => {
          let list = [...coinTransactions];
          if (where?.userId) list = list.filter((tx) => tx.userId === where.userId);
          if (where?.type) list = list.filter((tx) => tx.type === where.type);
          if (where?.referenceId) list = list.filter((tx) => tx.referenceId === where.referenceId);
          return list;
        }),
      },
      match: {
        findUnique: vi.fn(async ({ where }) => {
          const m = matches.get(where.id);
          return m ? { ...m } : null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const m = matches.get(where.id);
          if (!m) throw new Error(`Match ${where.id} not found`);
          Object.assign(m, data);
          return { ...m };
        }),
      },
      user: {
        findMany: vi.fn(async ({ where }) => {
          let list = Array.from(users.values());
          if (where?.id?.in) list = list.filter((u) => where.id.in.includes(u.id));
          if (where?.isBot !== undefined) list = list.filter((u) => u.isBot === where.isBot);
          return list;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const u = users.get(where.id);
          return u ? { ...u } : null;
        }),
      },
    };

    // Realistic PostgreSQL transaction wrapper:
    // Only reverts the mutations touched by THIS transaction if it throws (MVCC transaction isolation)
    prismaServiceMock = {
      ...dbClient,
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
        const activeLocks: (() => void)[] = [];
        const heldLockKeys = new Set<string>();
        const originalProfiles = new Map<string, ProfileState>();
        const originalMatches = new Map<string, MatchState>();
        const createdHoldIds: string[] = [];
        const originalHolds = new Map<string, HoldState>();
        const createdTxIds: string[] = [];

        const txClient = {
          $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
            const rawSql = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''), '');
            queryRawLogs.push(rawSql);
            if (rawSql.includes('FOR UPDATE') && rawSql.includes('PlayerProfile') && values[0]) {
              const lockKey = `PlayerProfile:${values[0]}`;
              if (!heldLockKeys.has(lockKey)) {
                heldLockKeys.add(lockKey);
                const release = await keyedMutex.lock(lockKey);
                activeLocks.push(release);
              }
            }
            return [];
          }),
          $queryRawUnsafe: vi.fn(async (sql: string, ...values: any[]) => {
            const formatted = `${sql} [${values.join(', ')}]`;
            queryRawLogs.push(formatted);
            if (sql.includes('FOR UPDATE') && sql.includes('Match') && values[0]) {
              const lockKey = `Match:${values[0]}`;
              if (!heldLockKeys.has(lockKey)) {
                heldLockKeys.add(lockKey);
                const release = await keyedMutex.lock(lockKey);
                activeLocks.push(release);
              }
            }
            return [];
          }),
          playerProfile: {
            findUnique: vi.fn(async (args) => prismaServiceMock.playerProfile.findUnique(args)),
            update: vi.fn(async (args) => {
              const uid = args.where.userId;
              if (!originalProfiles.has(uid) && profiles.has(uid)) {
                originalProfiles.set(uid, { ...profiles.get(uid)! });
              }
              return prismaServiceMock.playerProfile.update(args);
            }),
          },
          matchHold: {
            create: vi.fn(async (args) => {
              const res = await prismaServiceMock.matchHold.create(args);
              createdHoldIds.push(res.id);
              return res;
            }),
            findUnique: vi.fn(async (args) => prismaServiceMock.matchHold.findUnique(args)),
            findFirst: vi.fn(async (args) => prismaServiceMock.matchHold.findFirst(args)),
            findMany: vi.fn(async (args) => prismaServiceMock.matchHold.findMany(args)),
            update: vi.fn(async (args) => {
              const hid = args.where.id;
              if (!originalHolds.has(hid) && matchHolds.has(hid)) {
                originalHolds.set(hid, { ...matchHolds.get(hid)! });
              }
              return prismaServiceMock.matchHold.update(args);
            }),
          },
          coinTransaction: {
            findUnique: vi.fn(async (args) => prismaServiceMock.coinTransaction.findUnique(args)),
            create: vi.fn(async (args) => {
              const res = await prismaServiceMock.coinTransaction.create(args);
              createdTxIds.push(res.id);
              return res;
            }),
            findMany: vi.fn(async (args) => prismaServiceMock.coinTransaction.findMany(args)),
          },
          match: {
            findUnique: vi.fn(async (args) => prismaServiceMock.match.findUnique(args)),
            update: vi.fn(async (args) => {
              const mid = args.where.id;
              if (!originalMatches.has(mid) && matches.has(mid)) {
                originalMatches.set(mid, { ...matches.get(mid)! });
              }
              return prismaServiceMock.match.update(args);
            }),
          },
          user: {
            findMany: vi.fn(async (args) => prismaServiceMock.user.findMany(args)),
            findUnique: vi.fn(async (args) => prismaServiceMock.user.findUnique(args)),
          },
        };

        try {
          const result = await cb(txClient);
          return result;
        } catch (err) {
          // Transaction aborted: Rollback ONLY mutations from this transaction
          for (const [uid, orig] of originalProfiles.entries()) {
            profiles.set(uid, { ...orig });
          }
          for (const [mid, orig] of originalMatches.entries()) {
            matches.set(mid, { ...orig });
          }
          for (const hid of createdHoldIds) {
            matchHolds.delete(hid);
          }
          for (const [hid, orig] of originalHolds.entries()) {
            matchHolds.set(hid, { ...orig });
          }
          for (const txId of createdTxIds) {
            const idx = coinTransactions.findIndex((t) => t.id === txId);
            if (idx !== -1) coinTransactions.splice(idx, 1);
          }
          throw err;
        } finally {
          for (const release of activeLocks) {
            release();
          }
        }
      }),
    };

    walletService = new WalletService(prismaServiceMock as unknown as PrismaService);
  });

  // =========================================================================
  // TEST 1: YETERSİZ BAKİYE (Insufficient Balance Rejection)
  // =========================================================================
  it('Senaryo 1: Yetersiz bakiye — holdEntryFee reddedilmeli, bakiye bozulmamalı ve sıfır hold oluşmalı', async () => {
    createTestUser('user-broke', 50);

    expect(profiles.get('user-broke')!.balance).toBe(50);
    expect(profiles.get('user-broke')!.heldBalance).toBe(0);

    await expect(walletService.holdEntryFee('user-broke', 100)).rejects.toThrow('Bakiye yetersiz');

    const profileAfter = profiles.get('user-broke')!;
    expect(profileAfter.balance).toBe(50);
    expect(profileAfter.heldBalance).toBe(0);

    expect(Array.from(matchHolds.values()).filter((h) => h.userId === 'user-broke').length).toBe(0);
    expect(coinTransactions.filter((tx) => tx.userId === 'user-broke').length).toBe(0);
  });

  // =========================================================================
  // TEST 2: EŞZAMANLI BİRDEN FAZLA MAÇA KATILMA YARIŞI (Double Spending Prevention)
  // =========================================================================
  it('Senaryo 2: Aynı kullanıcının eşzamanlı olarak birden fazla maça katılmaya çalışması — Tam 1 talep onaylanmalı, bakiye eksiye düşmemeli', async () => {
    createTestUser('user-concurrency-race', 100);

    const initialBalance = profiles.get('user-concurrency-race')!.balance;
    const initialHeld = profiles.get('user-concurrency-race')!.heldBalance;
    expect(initialBalance).toBe(100);
    expect(initialHeld).toBe(0);

    const results = await Promise.allSettled([
      walletService.holdEntryFee('user-concurrency-race', 100, { matchId: 'match-p1' }),
      walletService.holdEntryFee('user-concurrency-race', 100, { matchId: 'match-p2' }),
      walletService.holdEntryFee('user-concurrency-race', 100, { matchId: 'match-p3' }),
      walletService.holdEntryFee('user-concurrency-race', 100, { matchId: 'match-p4' }),
      walletService.holdEntryFee('user-concurrency-race', 100, { matchId: 'match-p5' }),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(4);

    const finalProfile = profiles.get('user-concurrency-race')!;
    expect(finalProfile.balance).toBe(0);
    expect(finalProfile.heldBalance).toBe(100);
    expect(finalProfile.balance + finalProfile.heldBalance).toBe(100);

    const userHolds = Array.from(matchHolds.values()).filter((h) => h.userId === 'user-concurrency-race');
    expect(userHolds.length).toBe(1);
    expect(userHolds[0].status).toBe('HELD');
    expect(userHolds[0].amount).toBe(100);
  });

  // =========================================================================
  // TEST 3: AYNI MAÇ İÇİN TEKRAR HOLD OLUŞTURULMASI (Idempotency)
  // =========================================================================
  it('Senaryo 3: Aynı maç için tekrar hold oluşturulması — İdempotent olmalı, mevcut hold döner, ikinci kez bakiye düşmez', async () => {
    createTestUser('user-dup-hold', 1000);
    const matchId = 'match-same-hold-target';

    const firstRes = await walletService.holdEntryFee('user-dup-hold', 100, { matchId });
    expect(firstRes).not.toBeNull();
    const holdId = firstRes!.holdId;

    expect(profiles.get('user-dup-hold')!.balance).toBe(900);
    expect(profiles.get('user-dup-hold')!.heldBalance).toBe(100);

    const secondRes = await walletService.holdEntryFee('user-dup-hold', 100, { matchId });
    expect(secondRes).not.toBeNull();
    expect(secondRes!.holdId).toBe(holdId);

    const profile = profiles.get('user-dup-hold')!;
    expect(profile.balance).toBe(900);
    expect(profile.heldBalance).toBe(100);

    const holds = Array.from(matchHolds.values()).filter(
      (h) => h.userId === 'user-dup-hold' && h.matchId === matchId,
    );
    expect(holds.length).toBe(1);
    expect(holds[0].status).toBe('HELD');
  });

  // =========================================================================
  // TEST 4: AYNI HOLD İÇİN İKİ KEZ REFUND (Duplicate Refund Prevention)
  // =========================================================================
  it('Senaryo 4A: Aynı hold için sıralı iki kez refund (refundHoldRecord) — 1. başarılı, 2. reddedilir, çift iade oluşmaz', async () => {
    createTestUser('user-dup-refund', 500);
    const holdRes = await walletService.holdEntryFee('user-dup-refund', 100);
    const holdId = holdRes!.holdId;

    expect(profiles.get('user-dup-refund')!.balance).toBe(400);
    expect(profiles.get('user-dup-refund')!.heldBalance).toBe(100);

    const res1 = await walletService.refundHoldRecord(holdId);
    expect(res1).toBe(true);
    expect(profiles.get('user-dup-refund')!.balance).toBe(500);
    expect(profiles.get('user-dup-refund')!.heldBalance).toBe(0);

    const res2 = await walletService.refundHoldRecord(holdId);
    expect(res2).toBe(false);

    expect(profiles.get('user-dup-refund')!.balance).toBe(500);
    expect(profiles.get('user-dup-refund')!.heldBalance).toBe(0);

    const txs = coinTransactions.filter((tx) => tx.userId === 'user-dup-refund' && tx.type === 'MATCH_REFUND');
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBe(100);
    expect(txs[0].balanceBefore).toBe(400);
    expect(txs[0].balanceAfter).toBe(500);
  });

  it('Senaryo 4B: Aynı hold için eşzamanlı 5 paralel iade çağrısı — Yalnız 1 tanesi onaylanır, bakiye tam 1 kez artar', async () => {
    createTestUser('user-par-refund', 500);
    const holdRes = await walletService.holdEntryFee('user-par-refund', 100);
    const holdId = holdRes!.holdId;

    expect(profiles.get('user-par-refund')!.balance).toBe(400);
    expect(profiles.get('user-par-refund')!.heldBalance).toBe(100);

    const results = await Promise.all([
      walletService.refundHoldRecord(holdId),
      walletService.refundHoldRecord(holdId),
      walletService.refundHoldRecord(holdId),
      walletService.refundHoldRecord(holdId),
      walletService.refundHoldRecord(holdId),
    ]);

    const successes = results.filter((r) => r === true);
    const skips = results.filter((r) => r === false);

    expect(successes.length).toBe(1);
    expect(skips.length).toBe(4);

    expect(profiles.get('user-par-refund')!.balance).toBe(500);
    expect(profiles.get('user-par-refund')!.heldBalance).toBe(0);
    expect(matchHolds.get(holdId)!.status).toBe('REFUNDED');

    const txs = coinTransactions.filter((tx) => tx.userId === 'user-par-refund');
    expect(txs.length).toBe(1);
  });

  it('Senaryo 4C: refundMatchHolds için mükerrer çağrı — 2. çağrı 0 hold iade eder, bakiye kopyalanmaz', async () => {
    createTestUser('user-pve-1', 500);
    createTestUser('user-pve-2', 500);
    const matchId = 'match-pve-refund-dup';

    const h1 = await walletService.holdEntryFee('user-pve-1', 100);
    const h2 = await walletService.holdEntryFee('user-pve-2', 100);
    await walletService.bindHoldsToMatch(['user-pve-1', 'user-pve-2'], matchId);

    const r1 = await walletService.refundMatchHolds(matchId);
    expect(r1.refundedCount).toBe(2);
    expect(profiles.get('user-pve-1')!.balance).toBe(500);
    expect(profiles.get('user-pve-2')!.balance).toBe(500);

    const r2 = await walletService.refundMatchHolds(matchId);
    expect(r2.refundedCount).toBe(0);

    expect(profiles.get('user-pve-1')!.balance).toBe(500);
    expect(profiles.get('user-pve-2')!.balance).toBe(500);
  });

  // =========================================================================
  // TEST 5: AYNI MAÇIN İKİ KEZ SETTLE EDİLMESİ (Duplicate Settle Prevention)
  // =========================================================================
  it('Senaryo 5: Aynı maçın iki kez settle edilmesi — 1. settle ödülü dağıtır, 2. settle idempotent şekilde erken çıkar', async () => {
    const matchId = 'match-settle-dup';
    const winnerId = 'champ-user';
    const loserId = 'runner-up-user';

    createTestUser(winnerId, 400);
    createTestUser(loserId, 400);

    profiles.get(winnerId)!.heldBalance = 100;
    profiles.get(loserId)!.heldBalance = 100;

    matches.set(matchId, {
      id: matchId,
      gameModeId: 'classic_10',
      status: 'ACTIVE',
      settledAt: null,
      createdAt: new Date(),
    });

    await walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId]);

    const winnerP1 = profiles.get(winnerId)!;
    expect(winnerP1.balance).toBe(580);
    expect(winnerP1.heldBalance).toBe(0);
    expect(winnerP1.rating).toBe(1020);
    expect(winnerP1.wins).toBe(1);

    const loserP1 = profiles.get(loserId)!;
    expect(loserP1.balance).toBe(400);
    expect(loserP1.heldBalance).toBe(0);

    const matchState1 = matches.get(matchId)!;
    expect(matchState1.status).toBe('SETTLED');
    expect(matchState1.settledAt).toBeInstanceOf(Date);

    await walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId]);

    const winnerP2 = profiles.get(winnerId)!;
    expect(winnerP2.balance).toBe(580);
    expect(winnerP2.rating).toBe(1020);
    expect(winnerP2.wins).toBe(1);

    const rewardTxs = coinTransactions.filter((tx) => tx.userId === winnerId && tx.type === 'MATCH_REWARD');
    expect(rewardTxs.length).toBe(1);
  });

  // =========================================================================
  // TEST 6: KAZANAN ÖDÜLÜNÜN TEKRAR VERİLMESİNİN ENGELLENMESİ (Double Payout Concurrency Race)
  // =========================================================================
  it('Senaryo 6: Kazanan ödülünün tekrar verilmesi engeli — 3 paralel settleMatch yarışında ödül yalnız 1 kez yazılır', async () => {
    const matchId = 'match-race-reward';
    const winnerId = 'fast-winner';
    const loserId = 'slow-loser';

    createTestUser(winnerId, 0);
    createTestUser(loserId, 0);
    profiles.get(winnerId)!.heldBalance = 100;
    profiles.get(loserId)!.heldBalance = 100;

    matches.set(matchId, {
      id: matchId,
      gameModeId: 'classic_10',
      status: 'ACTIVE',
      settledAt: null,
      createdAt: new Date(),
    });

    await Promise.all([
      walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
      walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
      walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
    ]);

    const winnerP = profiles.get(winnerId)!;
    expect(winnerP.balance).toBe(180);
    expect(winnerP.heldBalance).toBe(0);
    expect(winnerP.rating).toBe(1020);
    expect(winnerP.wins).toBe(1);

    const winnerTxs = coinTransactions.filter(
      (tx) => tx.userId === winnerId && tx.type === 'MATCH_REWARD' && tx.referenceId === matchId,
    );
    expect(winnerTxs.length).toBe(1);
    expect(winnerTxs[0].amount).toBe(180);
    expect(winnerTxs[0].balanceBefore).toBe(0);
    expect(winnerTxs[0].balanceAfter).toBe(180);
  });

  // =========================================================================
  // TEST 7: TRANSACTION SIRASINDA BAĞLANTI KOPMASI / HATA (Atomic Rollback)
  // =========================================================================
  it('Senaryo 7A: holdEntryFee sırasında DB hatası/bağlantı kopması — Bakiye ve heldBalance atomik rollback ile korunur', async () => {
    createTestUser('user-tx-crash', 500);

    prismaServiceMock.matchHold.create = vi.fn().mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

    await expect(walletService.holdEntryFee('user-tx-crash', 100)).rejects.toThrow();

    const profile = profiles.get('user-tx-crash')!;
    expect(profile.balance).toBe(500);
    expect(profile.heldBalance).toBe(0);

    expect(matchHolds.size).toBe(0);
    expect(coinTransactions.length).toBe(0);
  });

  it('Senaryo 7B: settleMatch sırasında DB hatası — Match ACTIVE kalır, bakiye kısmi güncellenmez, tekrar denenince başarıyla tamamlanır', async () => {
    const matchId = 'match-settle-fail';
    const winnerId = 'hero-user';
    const loserId = 'sidekick-user';

    createTestUser(winnerId, 100);
    createTestUser(loserId, 100);
    profiles.get(winnerId)!.heldBalance = 100;
    profiles.get(loserId)!.heldBalance = 100;

    matches.set(matchId, {
      id: matchId,
      gameModeId: 'classic_10',
      status: 'ACTIVE',
      settledAt: null,
      createdAt: new Date(),
    });

    const originalMatchUpdate = prismaServiceMock.match.update;
    prismaServiceMock.match.update = vi.fn().mockRejectedValueOnce(new Error('PostgreSQL timeout'));

    await expect(
      walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
    ).rejects.toThrow();

    expect(matches.get(matchId)!.status).toBe('ACTIVE');
    expect(matches.get(matchId)!.settledAt).toBeNull();
    expect(profiles.get(winnerId)!.balance).toBe(100);
    expect(profiles.get(winnerId)!.heldBalance).toBe(100);
    expect(coinTransactions.length).toBe(0);

    prismaServiceMock.match.update = originalMatchUpdate;
    await walletService.settleMatch(matchId, winnerId, 100, [winnerId, loserId]);

    expect(matches.get(matchId)!.status).toBe('SETTLED');
    expect(profiles.get(winnerId)!.balance).toBe(280);
    expect(profiles.get(winnerId)!.heldBalance).toBe(0);
    expect(coinTransactions.length).toBe(1);
  });

  // =========================================================================
  // TEST 8: EŞZAMANLI 10 OYUNCUNUN GİRİŞ ÜCRETİ ÖDEMESİ VE REKABETÇİ SETTLEMENT
  // =========================================================================
  it('Senaryo 8: Eşzamanlı 10 oyuncunun giriş ücreti ödemesi ve sonuçlanması — 10 hold atomik oluşur, ödül dağıtımı deflasyoneldir', async () => {
    const playerIds: string[] = [];
    const matchId = 'room-10p-stress-test';

    matches.set(matchId, {
      id: matchId,
      gameModeId: 'classic_10',
      status: 'ACTIVE',
      settledAt: null,
      createdAt: new Date(),
    });

    for (let i = 1; i <= 10; i++) {
      const pid = `p10-player-${i}`;
      playerIds.push(pid);
      createTestUser(pid, 500);
    }

    const initialTotalCoins = Array.from(profiles.values()).reduce((sum, p) => sum + p.balance + p.heldBalance, 0);
    expect(initialTotalCoins).toBe(5000);

    const holdPromises = playerIds.map((pid) =>
      walletService.holdEntryFee(pid, 100, { gameModeId: 'classic_10', matchId }),
    );
    const holdResults = await Promise.all(holdPromises);

    expect(holdResults.every((h) => h !== null && h?.holdId)).toBe(true);

    for (const pid of playerIds) {
      const p = profiles.get(pid)!;
      expect(p.balance).toBe(400);
      expect(p.heldBalance).toBe(100);
    }

    const totalHeld = Array.from(profiles.values()).reduce((sum, p) => sum + p.heldBalance, 0);
    expect(totalHeld).toBe(1000);

    const winnerId = 'p10-player-1';
    await walletService.settleMatch(matchId, winnerId, 100, playerIds);

    const winnerP = profiles.get(winnerId)!;
    expect(winnerP.balance).toBe(1300);
    expect(winnerP.heldBalance).toBe(0);
    expect(winnerP.rating).toBe(1020);
    expect(winnerP.wins).toBe(1);

    for (const pid of playerIds.filter((id) => id !== winnerId)) {
      const p = profiles.get(pid)!;
      expect(p.balance).toBe(400);
      expect(p.heldBalance).toBe(0);
    }

    const finalTotalCoins = Array.from(profiles.values()).reduce((sum, p) => sum + p.balance + p.heldBalance, 0);
    expect(finalTotalCoins).toBe(4900);

    expect(initialTotalCoins - finalTotalCoins).toBe(100);

    const rewardTx = coinTransactions.find(
      (tx) => tx.userId === winnerId && tx.type === 'MATCH_REWARD' && tx.referenceId === matchId,
    );
    expect(rewardTx).toBeDefined();
    expect(rewardTx!.amount).toBe(900);
    expect(rewardTx!.balanceBefore).toBe(400);
    expect(rewardTx!.balanceAfter).toBe(1300);
  });

  // =========================================================================
  // TEST 9: POSTGRESQL ROW LOCK (FOR UPDATE) MEKANİZMASININ DOĞRULANMASI
  // =========================================================================
  it('Senaryo 9: PostgreSQL transaction ve row lock mekanizmalarının gerçekten çağrıldığını doğrula', async () => {
    createTestUser('user-lock-verify', 500);

    await walletService.holdEntryFee('user-lock-verify', 100);
    const hasPlayerProfileLock = queryRawLogs.some(
      (log) => log.includes('FOR UPDATE') && log.includes('PlayerProfile'),
    );
    expect(hasPlayerProfileLock).toBe(true);

    const mId = 'match-lock-verify';
    matches.set(mId, {
      id: mId,
      gameModeId: 'classic_10',
      status: 'ACTIVE',
      settledAt: null,
      createdAt: new Date(),
    });
    profiles.get('user-lock-verify')!.heldBalance = 100;

    await walletService.settleMatch(mId, 'user-lock-verify', 100, ['user-lock-verify']);
    const hasMatchLock = queryRawLogs.some(
      (log) => log.includes('FOR UPDATE') && log.includes('Match'),
    );
    expect(hasMatchLock).toBe(true);
  });

  // =========================================================================
  // TEST 10: REDIS KESİNTİSİNDE VEYA KİLİT SÜRESİ DOLDUĞUNDA SAF POSTGRESQL GÜVENCESİ
  // =========================================================================
  it('Senaryo 10A: Redis tamamen çöktüğünde / erişilemediğinde WalletService PostgreSQL ACID güvencesiyle hatasız çalışır', async () => {
    const deadRedisMock: any = {
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379')),
      set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379')),
      del: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379')),
      setNX: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379')),
    };

    const redisResilientWallet = new WalletService(
      prismaServiceMock as unknown as PrismaService,
      deadRedisMock as unknown as RedisService,
    );

    createTestUser('user-redis-dead', 300);

    const holdRes = await redisResilientWallet.holdEntryFee('user-redis-dead', 100);
    expect(holdRes?.holdId).toBeDefined();
    expect(profiles.get('user-redis-dead')!.balance).toBe(200);
    expect(profiles.get('user-redis-dead')!.heldBalance).toBe(100);

    const refundRes = await redisResilientWallet.refundHoldRecord(holdRes!.holdId);
    expect(refundRes).toBe(true);
    expect(profiles.get('user-redis-dead')!.balance).toBe(300);
    expect(profiles.get('user-redis-dead')!.heldBalance).toBe(0);
  });

  it('Senaryo 10B: Çoklu pod / servis örneğinde (Multi-Instance) DB satır kilidi ile çift harcama engellenir', async () => {
    const walletServiceA = new WalletService(prismaServiceMock as unknown as PrismaService);
    const walletServiceB = new WalletService(prismaServiceMock as unknown as PrismaService);

    createTestUser('user-multi-pod', 100);

    const results = await Promise.allSettled([
      walletServiceA.holdEntryFee('user-multi-pod', 100),
      walletServiceB.holdEntryFee('user-multi-pod', 100),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const rejects = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(rejects.length).toBe(1);

    expect(profiles.get('user-multi-pod')!.balance).toBe(0);
    expect(profiles.get('user-multi-pod')!.heldBalance).toBe(100);
  });

  // =========================================================================
  // TEST 11: PVE / BOT MAÇLARINDA KARŞILIKSIZ PARA BASILMAMASI
  // =========================================================================
  it('Senaryo 11: PvE modunda karşılıksız coin ve rating üretilmez — Kazanan bot maçı için 0 coin ve 0 rating alır', async () => {
    const matchId = 'match-pve-fairness';
    const humanId = 'human-pve-winner';
    const botId = 'bot-rival-1';

    createTestUser(humanId, 500, false);
    createTestUser(botId, 10000, true);

    matches.set(matchId, {
      id: matchId,
      gameModeId: 'classic_10',
      status: 'ACTIVE',
      settledAt: null,
      createdAt: new Date(),
    });

    profiles.get(humanId)!.heldBalance = 0;

    await walletService.settleMatch(matchId, humanId, 100, [humanId, botId], true);

    const winnerP = profiles.get(humanId)!;
    expect(winnerP.balance).toBe(500);
    expect(winnerP.heldBalance).toBe(0);
    expect(winnerP.rating).toBe(1000);
    expect(winnerP.wins).toBe(0);

    const rewardTxs = coinTransactions.filter((tx) => tx.referenceId === matchId && tx.type === 'MATCH_REWARD');
    expect(rewardTxs.length).toBe(0);
  });

  // =========================================================================
  // TEST 12: KAPSAMLI LEDGER BÜTÜNLÜĞÜ VE MUHASEBE AUDİTİ
  // =========================================================================
  it('Senaryo 12: Tüm cüzdan hareketlerinde CoinTransaction ledger tutarlılığı — balanceBefore + amount = balanceAfter', async () => {
    const userId = 'audit-user';
    const otherUserId = 'other-p';
    createTestUser(userId, 0);
    createTestUser(otherUserId, 400);

    // 1. Mağaza satın alımı: +500 coin
    await walletService.creditCoins(userId, 500, 'shop-order-1', 'SHOP_PURCHASE');
    expect(profiles.get(userId)!.balance).toBe(500);

    // 2. Maç kazancı: +180 coin
    const matchId = 'audit-match-1';
    matches.set(matchId, {
      id: matchId,
      gameModeId: 'quick_2',
      status: 'ACTIVE',
      settledAt: null,
      createdAt: new Date(),
    });
    profiles.get(userId)!.heldBalance = 100;
    profiles.get(userId)!.balance = 400;
    profiles.get(otherUserId)!.heldBalance = 100;

    await walletService.settleMatch(matchId, userId, 100, [userId, otherUserId]);
    expect(profiles.get(userId)!.balance).toBe(580);

    // 3. İade: +100 coin
    const holdRes = await walletService.holdEntryFee(userId, 100);
    expect(profiles.get(userId)!.balance).toBe(480);
    expect(profiles.get(userId)!.heldBalance).toBe(100);

    await walletService.refundHoldRecord(holdRes!.holdId);
    expect(profiles.get(userId)!.balance).toBe(580);
    expect(profiles.get(userId)!.heldBalance).toBe(0);

    const userLedger = coinTransactions.filter((tx) => tx.userId === userId);
    expect(userLedger.length).toBe(3);

    for (const tx of userLedger) {
      expect(tx.balanceBefore + tx.amount).toBe(tx.balanceAfter);
      expect(tx.referenceId).toBeDefined();
    }

    await expect(
      prismaServiceMock.coinTransaction.create({
        data: {
          userId,
          amount: 500,
          type: 'SHOP_PURCHASE',
          referenceId: 'shop-order-1',
          balanceBefore: 580,
          balanceAfter: 1080,
        },
      }),
    ).rejects.toThrow(/P2002/);
  });
});
