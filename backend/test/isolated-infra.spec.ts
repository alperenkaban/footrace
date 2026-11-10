import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { TestDbGuard } from '../src/config/test-db-guard.js';

describe('Faz 1: İzole PostgreSQL ve Redis Test Altyapısı Denetimi', () => {
  const TEST_DB_URL =
    process.env.TEST_DATABASE_URL ||
    'postgresql://root:rootpassword@localhost:5434/footquiz_test?schema=public';
  const TEST_REDIS_HOST = process.env.TEST_REDIS_HOST || 'localhost';
  const TEST_REDIS_PORT = Number(process.env.TEST_REDIS_PORT || 6380);

  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    // Test veritabanının kesinlikle izole ve güvenli olduğunu doğrula
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
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect().catch(() => {});
    }
    if (redis) {
      await redis.quit().catch(() => redis.disconnect());
    }
  });

  // ============================================================================
  // SUITE 1: Veritabanı ve Redis İzolasyon Kalkanı (Safety Guard)
  // ============================================================================
  describe('1. İzolasyon ve Güvenlik Kalkanı (Safety Guard)', () => {
    it('geliştirme veritabanı (footquiz) hedef alındığında güvenlik kalkanı testi engellemelidir', () => {
      const devDbUrl = 'postgresql://root:rootpassword@localhost:5433/footquiz?schema=public';
      const check = TestDbGuard.validateDatabaseUrl(devDbUrl);

      expect(check.isSafe).toBe(false);
      expect(check.dbName).toBe('footquiz');
      expect(check.reason).toContain('GÜVENLİK İHLALİ');
      expect(() => TestDbGuard.assertSafeTestDatabase(devDbUrl)).toThrowError(/GÜVENLİK İHLALİ/);
    });

    it('production veritabanı hedef alındığında güvenlik kalkanı testi engellemelidir', () => {
      const prodDbUrl = 'postgresql://postgres:prodpass@db.production.internal:5432/production';
      const check = TestDbGuard.validateDatabaseUrl(prodDbUrl);

      expect(check.isSafe).toBe(false);
      expect(check.dbName).toBe('production');
      expect(() => TestDbGuard.assertSafeTestDatabase(prodDbUrl)).toThrowError(/GÜVENLİK İHLALİ/);
    });

    it('test kalıbına (_test) uymayan standart bir veritabanı adı reddedilmelidir', () => {
      const unsafeDbUrl = 'postgresql://root:pass@localhost:5432/my_custom_db';
      const check = TestDbGuard.validateDatabaseUrl(unsafeDbUrl);

      expect(check.isSafe).toBe(false);
      expect(check.reason).toContain('GÜVENLİK UYARISI');
      expect(() => TestDbGuard.assertSafeTestDatabase(unsafeDbUrl)).toThrowError(/GÜVENLİK UYARISI/);
    });

    it('izole test veritabanı adı (footquiz_test) başarıyla onaylanmalıdır', () => {
      const check = TestDbGuard.validateDatabaseUrl(TEST_DB_URL);

      expect(check.isSafe).toBe(true);
      expect(check.dbName).toBe('footquiz_test');
      expect(check.port).toBe(5434);
    });

    it('host sistemde çakışmaya yol açabilecek varsayılan Redis portu (6379) test için reddedilmelidir', () => {
      const check = TestDbGuard.validateRedisConfig('localhost', 6379);

      expect(check.isSafe).toBe(false);
      expect(check.reason).toContain('GÜVENLİK UYARISI');
      expect(() => TestDbGuard.assertSafeTestRedis('localhost', 6379)).toThrowError(/GÜVENLİK UYARISI/);
    });

    it('izole test Redis portu (6380) güvenli olarak kabul edilmelidir', () => {
      const check = TestDbGuard.validateRedisConfig(TEST_REDIS_HOST, TEST_REDIS_PORT);

      expect(check.isSafe).toBe(true);
      expect(check.port).toBe(6380);
    });
  });

  // ============================================================================
  // SUITE 2: Gerçek PostgreSQL Bağlantısı, Tablolar ve Migration Durumu
  // ============================================================================
  describe('2. Gerçek PostgreSQL Bağlantısı ve Migration Denetimi', () => {
    it('izole test PostgreSQL servisine (port 5434) başarıyla bağlanabilmelidir', async () => {
      const probe = await TestDbGuard.probePostgres(TEST_DB_URL);

      expect(probe.reachable).toBe(true);
      expect(probe.isSafeTestDb).toBe(true);
      expect(probe.dbName).toBe('footquiz_test');
      expect(probe.port).toBe(5434);
    });

    it('Prisma şemasındaki tüm ana iş tabloları test veritabanında fiziksel olarak bulunmalıdır', async () => {
      const probe = await TestDbGuard.probePostgres(TEST_DB_URL);
      expect(probe.reachable).toBe(true);
      expect(probe.tables).toBeDefined();

      const requiredTables = [
        'User',
        'PlayerProfile',
        'GameMode',
        'Question',
        'QuestionVersion',
        'Match',
        'MatchPlayer',
        'MatchQuestion',
        'MatchHold',
        'CoinTransaction',
        'Answer',
        '_prisma_migrations',
      ];

      for (const table of requiredTables) {
        expect(probe.tables).toContain(table);
      }
    });

    it('tüm migrationlar (_prisma_migrations) başarıyla ve eksiksiz uygulanmış olmalıdır', async () => {
      const migrations = await prisma.$queryRaw<
        Array<{ migration_name: string; finished_at: Date }>
      >`SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at ASC`;

      expect(migrations.length).toBeGreaterThanOrEqual(2);

      const migrationNames = migrations.map((m) => m.migration_name);
      expect(migrationNames).toContain('20261011000000_init');
      expect(migrationNames).toContain('20261012_p0_match_hold_and_ledger');

      for (const m of migrations) {
        expect(m.finished_at).not.toBeNull();
      }
    });
  });

  // ============================================================================
  // SUITE 3: Gerçek PostgreSQL Transaction ve Rollback Güvenliği
  // ============================================================================
  describe('3. Gerçek PostgreSQL Transaction ve Rollback Bütünlüğü', () => {
    it('başarılı transaction veriyi kalıcı olarak (commit) yazmalıdır', async () => {
      const testUserId = `test-user-commit-${Date.now()}`;
      const testEmail = `${testUserId}@example.com`;

      await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: testUserId,
            email: testEmail,
            isGuest: false,
            profile: {
              create: {
                balance: 500,
                heldBalance: 0,
              },
            },
          },
        });
      });

      // Commit sonrası doğrula
      const savedUser = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { profile: true },
      });

      expect(savedUser).not.toBeNull();
      expect(savedUser?.email).toBe(testEmail);
      expect(savedUser?.profile?.balance).toBe(500);

      // Temizlik
      await prisma.playerProfile.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    });

    it('hata fırlatıldığında transaction tamamen geri alınmalı (rollback) ve yetim kayıt bırakmamalıdır', async () => {
      const testUserId = `test-user-rollback-${Date.now()}`;
      const testEmail = `${testUserId}@example.com`;

      let caughtError: Error | null = null;
      try {
        await prisma.$transaction(async (tx) => {
          // 1. Adım: Kullanıcı oluştur
          await tx.user.create({
            data: {
              id: testUserId,
              email: testEmail,
              isGuest: false,
            },
          });

          // 2. Adım: Kasıtlı hata fırlatarak işlemi patlat
          throw new Error('SIMULATED_TRANSACTION_CRASH');
        });
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toContain('SIMULATED_TRANSACTION_CRASH');

      // Rollback doğrulaması: Veritabanında kullanıcı kesinlikle bulunmamalıdır!
      const userAfterRollback = await prisma.user.findUnique({
        where: { id: testUserId },
      });
      expect(userAfterRollback).toBeNull();
    });

    it('yabancı anahtar (Foreign Key) ve unique kısıtları gerçek PostgreSQL motoru tarafından işletilmelidir', async () => {
      const nonExistentUserId = 'non-existent-user-uuid-9999';

      // Olmayan kullanıcıya profil ekleme denemesi P2003 (FK violation) vermelidir
      let fkErrorCaught = false;
      try {
        await prisma.playerProfile.create({
          data: {
            userId: nonExistentUserId,
            balance: 100,
            heldBalance: 0,
          },
        });
      } catch (err: any) {
        fkErrorCaught = true;
        expect(err.code).toBe('P2003');
      }

      expect(fkErrorCaught).toBe(true);
    });
  });

  // ============================================================================
  // SUITE 4: Gerçek Redis Bağlantısı, PING ve Key Yaşam Döngüsü
  // ============================================================================
  describe('4. Gerçek Redis Bağlantısı, PING ve TTL Denetimi', () => {
    it('izole test Redis servisine (port 6380) bağlanmalı ve PING komutuna PONG dönmelidir', async () => {
      const probe = await TestDbGuard.probeRedis(TEST_REDIS_HOST, TEST_REDIS_PORT);

      expect(probe.reachable).toBe(true);
      expect(probe.isSafeTestPort).toBe(true);
      expect(probe.pingResponse).toBe('PONG');
    });

    it('Redis üzerinde atomik veri yazma, okuma, TTL belirleme ve silme işlemleri çalışmalıdır', async () => {
      await redis.connect().catch(() => {}); // zaten bağlıysa görmezden gel

      const key = `test:infra:key:${Date.now()}`;
      const value = JSON.stringify({ status: 'active', timestamp: Date.now() });

      // Yaz (10 sn TTL)
      await redis.set(key, value, 'EX', 10);

      // Oku
      const readVal = await redis.get(key);
      expect(readVal).toBe(value);

      // Kalan TTL kontrolü
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);

      // Sil
      await redis.del(key);
      const afterDel = await redis.get(key);
      expect(afterDel).toBeNull();
    });
  });

  // ============================================================================
  // SUITE 5: Gerçek Redis Dağıtık Kilit (Distributed Lock / Mutex)
  // ============================================================================
  describe('5. Gerçek Redis Dağıtık Kilit (SETNX Lock) Mekanizması', () => {
    it('SETNX kilidi ilk talep eden almalı, eşzamanlı ikinci talep reddedilmelidir', async () => {
      await redis.connect().catch(() => {});

      const lockKey = `lock:test:resource:${Date.now()}`;
      const token1 = 'worker-1-uuid';
      const token2 = 'worker-2-uuid';

      // 1. Worker 1 kilidi alır (10 saniye geçerli)
      const acquire1 = await redis.set(lockKey, token1, 'PX', 10000, 'NX');
      expect(acquire1).toBe('OK');

      // 2. Worker 2 aynı anda kilidi almaya çalışır -> Başarısız olmalıdır (null)
      const acquire2 = await redis.set(lockKey, token2, 'PX', 10000, 'NX');
      expect(acquire2).toBeNull();

      // Kilitteki mevcut token'ın Worker 1'e ait olduğunu doğrula
      const currentToken = await redis.get(lockKey);
      expect(currentToken).toBe(token1);

      // 3. Worker 1 kilidi serbest bırakır
      await redis.del(lockKey);

      // 4. Şimdi Worker 2 kilidi başarıyla alabilir
      const acquire3 = await redis.set(lockKey, token2, 'PX', 10000, 'NX');
      expect(acquire3).toBe('OK');

      // Temizlik
      await redis.del(lockKey);
    });

    it('farklı kilit anahtarları birbirini bloke etmemelidir', async () => {
      await redis.connect().catch(() => {});

      const lockKeyA = `lock:player:alpha:${Date.now()}`;
      const lockKeyB = `lock:player:beta:${Date.now()}`;

      const resA = await redis.set(lockKeyA, 'token-a', 'PX', 5000, 'NX');
      const resB = await redis.set(lockKeyB, 'token-b', 'PX', 5000, 'NX');

      expect(resA).toBe('OK');
      expect(resB).toBe('OK');

      await redis.del(lockKeyA, lockKeyB);
    });

    it('süresi dolan (TTL) kilit otomatik olarak serbest kalmalıdır', async () => {
      await redis.connect().catch(() => {});

      const lockKey = `lock:short-ttl:${Date.now()}`;
      // 50 milisaniyelik kısa kilit
      await redis.set(lockKey, 'temp-token', 'PX', 50, 'NX');

      // 80ms bekle (kilit zaman aşımına uğramalı)
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Kilit süresi dolduğu için yeni talep başarılı olmalıdır
      const reAcquire = await redis.set(lockKey, 'new-token', 'PX', 1000, 'NX');
      expect(reAcquire).toBe('OK');

      await redis.del(lockKey);
    });
  });

  // ============================================================================
  // SUITE 6: Kapalı Servis Tespiti ve Temiz Raporlama (Offline Service Reporting)
  // ============================================================================
  describe('6. Kapalı Servis Tespiti ve Raporlama (Offline Safety)', () => {
    it('ulaşılamayan bir PostgreSQL portuna bağlanıldığında crash olmadan rapor üretmelidir', async () => {
      const unreachableUrl =
        'postgresql://root:rootpassword@localhost:5439/footquiz_test?schema=public';
      const probe = await TestDbGuard.probePostgres(unreachableUrl, 1000);

      expect(probe.reachable).toBe(false);
      expect(probe.isSafeTestDb).toBe(true);
      expect(probe.error).toBeDefined();
    });

    it('ulaşılamayan bir Redis portuna bağlanıldığında crash olmadan rapor üretmelidir', async () => {
      const probe = await TestDbGuard.probeRedis('localhost', 6389, 1000);

      expect(probe.reachable).toBe(false);
      expect(probe.isSafeTestPort).toBe(true);
      expect(probe.error).toBeDefined();
    });
  });
});
