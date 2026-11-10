import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { WalletService } from '../src/wallet/wallet.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { TestDbGuard } from '../src/config/test-db-guard.js';
import { BadRequestException } from '@nestjs/common';

describe('Faz 2: Wallet ve CoinTransaction Eşzamanlılık Denetimi (Gerçek PostgreSQL & Redis)', () => {
  const TEST_DB_URL =
    process.env.TEST_DATABASE_URL ||
    'postgresql://root:rootpassword@localhost:5434/footquiz_test?schema=public';
  const TEST_REDIS_HOST = process.env.TEST_REDIS_HOST || 'localhost';
  const TEST_REDIS_PORT = Number(process.env.TEST_REDIS_PORT || 6380);

  let prisma: PrismaClient;
  let redis: Redis;
  let redisService: RedisService;
  let walletServiceA: WalletService;
  let walletServiceB: WalletService;

  beforeAll(async () => {
    // 1. İzolasyon Kalkanı: Geliştirme veya prod veritabanına dokunulmadığını doğrula
    TestDbGuard.assertSafeTestDatabase(TEST_DB_URL);
    TestDbGuard.assertSafeTestRedis(TEST_REDIS_HOST, TEST_REDIS_PORT);

    prisma = new PrismaClient({
      datasources: {
        db: { url: TEST_DB_URL },
      },
    });

    redis = new Redis({
      host: TEST_REDIS_HOST,
      port: TEST_REDIS_PORT,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    await redis.connect().catch(() => {});
    redisService = new RedisService(redis);

    // İki farklı instance oluştur (Çoklu pod / multi-instance simülasyonu)
    walletServiceA = new WalletService(prisma as any, redisService);
    walletServiceB = new WalletService(prisma as any, redisService);

    // Standart test oyun modu (classic_10) oluştur / doğrula
    await prisma.gameMode.upsert({
      where: { name: 'classic_10' },
      update: {},
      create: {
        id: 'mode-classic-10-p2',
        name: 'classic_10',
        maxPlayers: 10,
        questionCount: 10,
        questionDuration: 15,
        entryFee: 100,
        rewardMultiplier: 1.0,
        ratingEnabled: true,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect().catch(() => {});
    }
    if (redis) {
      await redis.quit().catch(() => redis.disconnect());
    }
  });

  // Test kullanıcısı oluşturucu yardımcı fonksiyon
  async function setupTestUser(userId: string, initialBalance = 1000, isBot = false) {
    // Önceki test artıklarını temizle
    await prisma.coinTransaction.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.matchHold.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.matchPlayer.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.playerProfile.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});

    const user = await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@test-concurrency.local`,
        isGuest: false,
        isBot,
        profile: {
          create: {
            balance: initialBalance,
            heldBalance: 0,
            rating: 1000,
            wins: 0,
            losses: 0,
            totalGames: 0,
          },
        },
      },
      include: { profile: true },
    });

    return user;
  }

  // ============================================================================
  // SENARYO 1: EŞZAMANLI MIXED CÜZDAN İŞLEMLERİ (HOLD, SPEND, CREDIT, REFUND)
  // ============================================================================
  describe('1. Eşzamanlı Mixed Cüzdan İşlemleri (Hold, Spend, Credit, Refund)', () => {
    it('aynı kullanıcı için eşzamanlı mixed işlemlerde bakiye asla eksiye düşmemeli ve ledger tutarlı kalmalıdır', async () => {
      const userId = 'u-race-mixed-1';
      const initialBalance = 500;
      await setupTestUser(userId, initialBalance);

      // 10 Hold (100 coin), 10 Spend (50 coin), 10 Credit (100 coin)
      const operations: Promise<any>[] = [];

      for (let i = 0; i < 10; i++) {
        operations.push(
          walletServiceA.holdEntryFee(userId, 100).catch((err) => ({ error: err.message, type: 'HOLD' })),
        );
        operations.push(
          walletServiceB.spendCoins(userId, 50, `spend-mix-${i}`).catch((err) => ({ error: err.message, type: 'SPEND' })),
        );
        operations.push(
          walletServiceA.creditCoins(userId, 100, `credit-mix-${i}`, 'SHOP_PURCHASE').catch((err) => ({ error: err.message, type: 'CREDIT' })),
        );
      }

      // Tüm işlemleri AYNI ANDA paralel olarak ateşle
      const results = await Promise.all(operations);

      // Güncel profil durumunu gerçek veritabanından çek
      const finalProfile = await prisma.playerProfile.findUnique({
        where: { userId },
      });

      expect(finalProfile).toBeDefined();
      expect(finalProfile!.balance).toBeGreaterThanOrEqual(0);
      expect(finalProfile!.heldBalance).toBeGreaterThanOrEqual(0);

      // Başarılı işlemleri say
      const successfulHolds = await prisma.matchHold.findMany({
        where: { userId, status: 'HELD' },
      });
      const successfulTransactions = await prisma.coinTransaction.findMany({
        where: { userId },
      });

      const totalHeldAmount = successfulHolds.reduce((sum, h) => sum + h.amount, 0);
      expect(finalProfile!.heldBalance).toBe(totalHeldAmount);

      // Ledger denklemi:
      // final.balance + final.heldBalance === initialBalance + totalCredits - totalSpends
      const totalCredited = successfulTransactions
        .filter((tx) => tx.amount > 0)
        .reduce((sum, tx) => sum + tx.amount, 0);
      const totalSpent = successfulTransactions
        .filter((tx) => tx.amount < 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

      const totalFundsInSystem = finalProfile!.balance + finalProfile!.heldBalance;
      const expectedTotalFunds = initialBalance + totalCredited - totalSpent;

      expect(totalFundsInSystem).toBe(expectedTotalFunds);

      // Her bir işlem sonucunda balanceBefore + amount === balanceAfter olmalıdır
      for (const tx of successfulTransactions) {
        expect(tx.balanceBefore + tx.amount).toBe(tx.balanceAfter);
      }
    });
  });

  // ============================================================================
  // SENARYO 2: ÇİFT HARCAMA ENGELİ (DOUBLE SPENDING UNDER HIGH CONCURRENCY)
  // ============================================================================
  describe('2. Yüksek Eşzamanlılık Altında Çift Harcama Engeli (Double Spending Prevention)', () => {
    it('100 coin bakiyesi olan kullanıcı için aynı anda gelen 10 adet 100 coinlik harcama isteğinden tam 1 tanesi başarılı olmalıdır', async () => {
      const userId = 'u-race-double-spend';
      await setupTestUser(userId, 100);

      // 10 paralel istek aynı anda 100 coin harcamaya çalışır
      const spendPromises = Array.from({ length: 10 }).map((_, idx) =>
        walletServiceA
          .spendCoins(userId, 100, `spend-race-${idx}`, 'COIN_SPEND')
          .then((res) => ({ success: true, res }))
          .catch((err) => ({ success: false, error: err.message })),
      );

      const results = await Promise.all(spendPromises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(9);
      for (const f of failures) {
        expect(f.error).toContain('Bakiye yetersiz');
      }

      // Veritabanındaki kesin durum
      const profile = await prisma.playerProfile.findUnique({ where: { userId } });
      expect(profile!.balance).toBe(0); // Kesinlikle 0, ASLA negatif değil!
      expect(profile!.heldBalance).toBe(0);

      // Yalnızca 1 CoinTransaction kaydı oluşmalı
      const txs = await prisma.coinTransaction.findMany({ where: { userId } });
      expect(txs.length).toBe(1);
      expect(txs[0].amount).toBe(-100);
      expect(txs[0].balanceBefore).toBe(100);
      expect(txs[0].balanceAfter).toBe(0);
    });

    it('100 coin bakiyesi olan kullanıcı için aynı anda gelen 10 adet 100 coinlik hold isteğinden tam 1 tanesi başarılı olmalıdır', async () => {
      const userId = 'u-race-double-hold';
      await setupTestUser(userId, 100);

      const holdPromises = Array.from({ length: 10 }).map((_, idx) =>
        walletServiceB
          .holdEntryFee(userId, 100, { gameModeId: 'mode-classic-10-p2' })
          .then((res) => ({ success: true, res }))
          .catch((err) => ({ success: false, error: err.message })),
      );

      const results = await Promise.all(holdPromises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(9);
      for (const f of failures) {
        expect(f.error).toContain('Bakiye yetersiz');
      }

      const profile = await prisma.playerProfile.findUnique({ where: { userId } });
      expect(profile!.balance).toBe(0);
      expect(profile!.heldBalance).toBe(100);

      const holds = await prisma.matchHold.findMany({ where: { userId, status: 'HELD' } });
      expect(holds.length).toBe(1);
      expect(holds[0].amount).toBe(100);
    });
  });

  // ============================================================================
  // SENARYO 3: ÇİFT ÖDÜL VE İDEMPOTENCY DENETİMİ (IDEMPOTENT REWARDS & SETTLEMENT)
  // ============================================================================
  describe('3. Çift Ödül ve İdempotency Denetimi (Idempotent Rewards & Settlement)', () => {
    it('aynı referenceId ile eşzamanlı gelen 10 creditCoins isteği ödülü yalnızca 1 kez vermelidir', async () => {
      const userId = 'u-race-dup-reward';
      await setupTestUser(userId, 100);

      const dupReferenceId = 'iap_order_unique_receipt_999';

      // 10 paralel istek aynı makbuz ID ile 500 coin yüklemeye çalışır
      const creditPromises = Array.from({ length: 10 }).map(() =>
        walletServiceA.creditCoins(userId, 500, dupReferenceId, 'SHOP_PURCHASE'),
      );

      await Promise.all(creditPromises);

      const profile = await prisma.playerProfile.findUnique({ where: { userId } });
      expect(profile!.balance).toBe(600); // 100 + 500 = 600 (Asla 5100 olamaz!)

      const txs = await prisma.coinTransaction.findMany({
        where: { userId, referenceId: dupReferenceId },
      });
      expect(txs.length).toBe(1); // Yalnızca tek bir satır yazılmış olmalıdır
      expect(txs[0].amount).toBe(500);
      expect(txs[0].balanceBefore).toBe(100);
      expect(txs[0].balanceAfter).toBe(600);
    });

    it('çoklu instance üzerinden aynı maça eşzamanlı gelen settleMatch çağrılarında ödül yalnızca 1 kez dağıtılmalıdır', async () => {
      const winnerId = 'u-settle-winner-p2';
      const loserId = 'u-settle-loser-p2';
      await setupTestUser(winnerId, 200);
      await setupTestUser(loserId, 200);

      const matchId = `match-settle-race-${Date.now()}`;

      // Maç oluştur
      await prisma.match.create({
        data: {
          id: matchId,
          gameModeId: 'mode-classic-10-p2',
          status: 'ACTIVE',
        },
      });

      // Her iki oyuncunun hold kayıtlarını oluştur
      const holdW = await walletServiceA.holdEntryFee(winnerId, 100, { matchId });
      const holdL = await walletServiceB.holdEntryFee(loserId, 100, { matchId });
      expect(holdW).toBeDefined();
      expect(holdL).toBeDefined();

      // 4 eşzamanlı settleMatch çağrısı (2 tanesi instanceA, 2 tanesi instanceB üzerinden)
      const settlements = [
        walletServiceA.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
        walletServiceB.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
        walletServiceA.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
        walletServiceB.settleMatch(matchId, winnerId, 100, [winnerId, loserId]),
      ];

      await Promise.allSettled(settlements);

      // Maç SETTLED olmalıdır
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      expect(match!.status).toBe('SETTLED');
      expect(match!.settledAt).toBeDefined();

      // Kazanan ödülü: 2 oyuncu * 100 = 200 total pot, %10 cut = 20, prizePool = 180
      // Winner bakiye: 200 - 100 (hold) + 180 (prize) = 280
      const winP = await prisma.playerProfile.findUnique({ where: { userId: winnerId } });
      expect(winP!.balance).toBe(280);
      expect(winP!.heldBalance).toBe(0);
      expect(winP!.wins).toBe(1);

      // Kaybeden bakiye: 200 - 100 (hold settled) = 100
      const loseP = await prisma.playerProfile.findUnique({ where: { userId: loserId } });
      expect(loseP!.balance).toBe(100);
      expect(loseP!.heldBalance).toBe(0);

      // MATCH_REWARD transaction sayısı tam 1 olmalıdır
      const rewardTxs = await prisma.coinTransaction.findMany({
        where: { referenceId: matchId, type: 'MATCH_REWARD' },
      });
      expect(rewardTxs.length).toBe(1);
      expect(rewardTxs[0].amount).toBe(180);
      expect(rewardTxs[0].userId).toBe(winnerId);
    });
  });

  // ============================================================================
  // SENARYO 4: KAYIP TRANSACTION VE BALANCE-LEDGER TUTARLILIĞI (FULL RECONCILE)
  // ============================================================================
  describe('4. Kayıp Transaction ve Balance-Ledger Tutarlılığı (Full Ledger Reconcile Audit)', () => {
    it('20 paralel kredi ve 10 paralel harcama sonrasında sıfır kayıp transaction ve tam balance-ledger eşleşmesi olmalıdır', async () => {
      const userId = 'u-race-audit-ledger';
      await setupTestUser(userId, 0); // Başlangıç 0

      // 20 Kredi (+100 = +2000)
      const creditPromises = Array.from({ length: 20 }).map((_, idx) =>
        walletServiceA.creditCoins(userId, 100, `ledger-credit-${idx}`, 'SHOP_PURCHASE'),
      );
      await Promise.all(creditPromises);

      // 10 Harcama (-50 = -500)
      const spendPromises = Array.from({ length: 10 }).map((_, idx) =>
        walletServiceB.spendCoins(userId, 50, `ledger-spend-${idx}`, 'ITEM_PURCHASE'),
      );
      await Promise.all(spendPromises);

      const profile = await prisma.playerProfile.findUnique({ where: { userId } });
      expect(profile!.balance).toBe(1500); // 2000 - 500 = 1500
      expect(profile!.heldBalance).toBe(0);

      const allTxs = await prisma.coinTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });

      expect(allTxs.length).toBe(30); // Hiçbir transaction kaybolmamalıdır!

      // Kümülatif tutarlılık kontrolü
      let runningBalance = 0;
      for (const tx of allTxs) {
        expect(tx.balanceBefore + tx.amount).toBe(tx.balanceAfter);
        runningBalance += tx.amount;
      }

      expect(runningBalance).toBe(1500);
      expect(profile!.balance).toBe(runningBalance);
    });
  });

  // ============================================================================
  // SENARYO 5: BALANCE VE HELDBALANCE YAŞAM DÖNGÜSÜ BÜTÜNLÜĞÜ
  // ============================================================================
  describe('5. balance ve heldBalance Yaşam Döngüsü Bütünlüğü', () => {
    it('hold, refund, settle ve release adımlarında balance ve heldBalance kuruşu kuruşuna doğru kalmalıdır', async () => {
      const userId = 'u-lifecycle-balance';
      await setupTestUser(userId, 400);

      // 1. Hold 100
      const hold1 = await walletServiceA.holdEntryFee(userId, 100, { gameModeId: 'mode-classic-10-p2' });
      expect(hold1).toBeDefined();
      let state = await walletServiceA.getBalance(userId);
      expect(state.balance).toBe(300);
      expect(state.heldBalance).toBe(100);

      // 2. Hold 100 daha
      const hold2 = await walletServiceA.holdEntryFee(userId, 100, { gameModeId: 'mode-classic-10-p2' });
      expect(hold2).toBeDefined();
      state = await walletServiceA.getBalance(userId);
      expect(state.balance).toBe(200);
      expect(state.heldBalance).toBe(200);

      // 3. Hold 1 iade et (refundHoldRecord)
      const refundOk = await walletServiceA.refundHoldRecord(hold1!.holdId);
      expect(refundOk).toBe(true);
      state = await walletServiceA.getBalance(userId);
      expect(state.balance).toBe(300);
      expect(state.heldBalance).toBe(100);

      // 4. Hold 2 serbest bırak (releaseHold)
      await walletServiceA.releaseHold(userId, 100);
      state = await walletServiceA.getBalance(userId);
      expect(state.balance).toBe(400);
      expect(state.heldBalance).toBe(0);
    });
  });

  // ============================================================================
  // SENARYO 6: REDIS BAĞLANTISI KESİLDİĞİNDE GÜVENLİ DAVRANIŞ (RESILIENCE)
  // ============================================================================
  describe('6. Redis Bağlantısı Kesildiğinde Güvenli Davranış (Redis Outage Resilience)', () => {
    it('Redis tamamen kapalı / ulaşılamaz olduğunda PostgreSQL FOR UPDATE satır kilidi ile çift harcama engellenmelidir', async () => {
      const userId = 'u-race-redis-dead';
      await setupTestUser(userId, 100);

      // Ulaşılamayan bir Redis portu ile mock/özel client oluştur
      const deadRedisMock: any = {
        get: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); },
        set: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); },
        del: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); },
        setNX: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); },
      };

      const resilientWallet = new WalletService(prisma as any, deadRedisMock);

      // 5 eşzamanlı harcama isteği
      const spendPromises = Array.from({ length: 5 }).map((_, idx) =>
        resilientWallet
          .spendCoins(userId, 100, `spend-dead-redis-${idx}`)
          .then(() => ({ success: true }))
          .catch((err) => ({ success: false, error: err.message })),
      );

      const results = await Promise.all(spendPromises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(4);

      const profile = await prisma.playerProfile.findUnique({ where: { userId } });
      expect(profile!.balance).toBe(0);
      expect(profile!.heldBalance).toBe(0);
    });
  });

  // ============================================================================
  // SENARYO 7: REDIS LOCK TTL SÜRESİ DOLDUĞUNDA GÜVENLİ DAVRANIŞ (LOCK EXPIRY PROTECTION)
  // ============================================================================
  describe('7. Redis Lock TTL Süresi Dolduğunda Güvenli Davranış (Lock Expiry Protection)', () => {
    it('Redis kilidi expire olduğunda bile PostgreSQL FOR UPDATE satır kilidi tutarlılığı garanti etmelidir', async () => {
      const userId = 'u-race-lock-expiry';
      await setupTestUser(userId, 100);

      // 1. Redis'e kısa ömürlü bir kilit koy (1 saniye TTL)
      const lockKey = `wallet_user_lock:${userId}`;
      await redis.set(lockKey, 'stale_token_test', 'PX', 200); // 200 ms TTL

      // 250ms bekle -> Redis kilidinin süresi dolsun
      await new Promise((resolve) => setTimeout(resolve, 250));

      const lockInRedis = await redis.get(lockKey);
      expect(lockInRedis).toBeNull(); // Kilit düşmüş olmalı

      // Şimdi iki eşzamanlı işlem çalıştır
      const [res1, res2] = await Promise.allSettled([
        walletServiceA.spendCoins(userId, 100, 'spend-after-expire-1'),
        walletServiceB.spendCoins(userId, 100, 'spend-after-expire-2'),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const profile = await prisma.playerProfile.findUnique({ where: { userId } });
      expect(profile!.balance).toBe(0);
    });
  });

  // ============================================================================
  // SENARYO 8: ÇOKLU SERVİS ÖRNEĞİ EŞZAMANLI YARIŞI (MULTI-INSTANCE POD RACE)
  // ============================================================================
  describe('8. Çoklu Servis Örneği Eşzamanlı Yarışı (Multi-Instance Pod Race)', () => {
    it('instanceA ve instanceB aynı anda aynı kullanıcının bakiyesini tüketmeye çalıştığında yarış durumu oluşmamalıdır', async () => {
      const userId = 'u-multi-instance-race';
      await setupTestUser(userId, 300);

      // Instance A ve Instance B üzerinden karışık 6 istek (her biri 100 coin)
      const reqs = [
        walletServiceA.spendCoins(userId, 100, 'req-A-1'),
        walletServiceB.spendCoins(userId, 100, 'req-B-1'),
        walletServiceA.spendCoins(userId, 100, 'req-A-2'),
        walletServiceB.spendCoins(userId, 100, 'req-B-2'),
        walletServiceA.spendCoins(userId, 100, 'req-A-3'),
        walletServiceB.spendCoins(userId, 100, 'req-B-3'),
      ];

      const results = await Promise.allSettled(reqs);

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const rejectCount = results.filter((r) => r.status === 'rejected').length;

      expect(successCount).toBe(3); // Tam olarak 300 / 100 = 3 başarılı
      expect(rejectCount).toBe(3); // 3 yetersiz bakiye reddi

      const profile = await prisma.playerProfile.findUnique({ where: { userId } });
      expect(profile!.balance).toBe(0);
      expect(profile!.heldBalance).toBe(0);
    });
  });
});
