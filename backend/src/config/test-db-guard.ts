import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';

export interface DatabaseValidationResult {
  isSafe: boolean;
  dbName: string;
  host: string;
  port: number;
  reason?: string;
}

export interface RedisValidationResult {
  isSafe: boolean;
  host: string;
  port: number;
  reason?: string;
}

export interface ServiceHealthReport {
  postgres: {
    reachable: boolean;
    isSafeTestDb: boolean;
    dbName: string;
    port: number;
    error?: string;
    appliedMigrationsCount?: number;
  };
  redis: {
    reachable: boolean;
    isSafeTestPort: boolean;
    host: string;
    port: number;
    error?: string;
  };
}

/**
 * Test Ortamı Güvenlik ve İzolasyon Kalkanı (Safety Guard)
 * Production veya geliştirme veritabanının (footquiz) yanlışlıkla testler tarafından
 * silinmesini, üzerine yazılmasını veya kirletilmesini kesin olarak engeller.
 */
export class TestDbGuard {
  private static FORBIDDEN_DB_NAMES = ['footquiz', 'production', 'prod', 'master', 'main'];
  private static FORBIDDEN_DEV_PORTS = [5432, 5433]; // 5433 dev DB portudur
  private static SAFE_TEST_DB_PATTERNS = [/_test$/, /^test_/, /_test_fresh$/, /footquiz_test/];

  /**
   * DATABASE_URL'i analiz ederek test için güvenli olup olmadığını doğrular.
   */
  public static validateDatabaseUrl(rawUrl?: string): DatabaseValidationResult {
    const urlStr = rawUrl || process.env.DATABASE_URL || '';
    if (!urlStr) {
      return {
        isSafe: false,
        dbName: '',
        host: '',
        port: 0,
        reason: 'DATABASE_URL boş veya tanımlanmamış.',
      };
    }

    try {
      const parsed = new URL(urlStr.replace('postgresql://', 'http://'));
      const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
      const host = parsed.hostname;
      const port = Number(parsed.port) || 5432;

      // 1. Yasaklı DB isim kontrolü
      if (this.FORBIDDEN_DB_NAMES.includes(dbName.toLowerCase())) {
        return {
          isSafe: false,
          dbName,
          host,
          port,
          reason: `GÜVENLİK İHLALİ: '${dbName}' geliştirme veya production veritabanıdır! Testler bu veritabanında çalıştırılamaz. İzole test veritabanı (örn: 'footquiz_test') kullanılmalıdır.`,
        };
      }

      // 2. Güvenli test DB adı kontrolü
      const isTestNamed = this.SAFE_TEST_DB_PATTERNS.some((pattern) => pattern.test(dbName));
      if (!isTestNamed) {
        return {
          isSafe: false,
          dbName,
          host,
          port,
          reason: `GÜVENLİK UYARISI: '${dbName}' adı güvenli bir test veritabanı kalıbına (_test) uymuyor. Test veritabanı adı 'footquiz_test' olmalıdır.`,
        };
      }

      // 3. Port ve isim kombinasyonu kontrolü: Port 5433 ve footquiz eşleşmesi kesinlikle yasaktır
      if (port === 5433 && dbName === 'footquiz') {
        return {
          isSafe: false,
          dbName,
          host,
          port,
          reason: `GÜVENLİK İHLALİ: Port 5433 ve 'footquiz' DB'si yerel geliştirme ortamıdır. Testler port 5434 ve 'footquiz_test' izole servisinde çalışmalıdır.`,
        };
      }

      return {
        isSafe: true,
        dbName,
        host,
        port,
      };
    } catch (err: any) {
      return {
        isSafe: false,
        dbName: '',
        host: '',
        port: 0,
        reason: `DATABASE_URL formatı geçersiz: ${err.message}`,
      };
    }
  }

  /**
   * Test veritabanı güvenli değilse fatal error fırlatır.
   */
  public static assertSafeTestDatabase(rawUrl?: string): void {
    const result = this.validateDatabaseUrl(rawUrl);
    if (!result.isSafe) {
      throw new Error(`[TestDbGuard Assertion Failed] ${result.reason}`);
    }
  }

  /**
   * Redis test yapılandırmasını doğrular.
   * Hosttaki diğer projelere (port 6379) veya dev redis'e kazara yazılmasını engeller.
   */
  public static validateRedisConfig(host?: string, port?: number): RedisValidationResult {
    const targetHost = host || process.env.REDIS_HOST || 'localhost';
    const targetPort = Number(port || process.env.REDIS_PORT || 6380);

    // Port 6379 çakışma uyarısı (Pazaryeri vb. sistem servisleri)
    if (targetPort === 6379 && !process.env.ALLOW_DEFAULT_REDIS_PORT_FOR_TESTS) {
      return {
        isSafe: false,
        host: targetHost,
        port: targetPort,
        reason: `GÜVENLİK UYARISI: Port 6379 host sistemdeki diğer servislere ait olabilir. İzole test Redis'i (port 6380) kullanılmalıdır. Zorlamak için ALLOW_DEFAULT_REDIS_PORT_FOR_TESTS=1 belirleyin.`,
      };
    }

    return {
      isSafe: true,
      host: targetHost,
      port: targetPort,
    };
  }

  /**
   * Redis test yapılandırması güvenli değilse hata fırlatır.
   */
  public static assertSafeTestRedis(host?: string, port?: number): void {
    const result = this.validateRedisConfig(host, port);
    if (!result.isSafe) {
      throw new Error(`[TestDbGuard Assertion Failed] ${result.reason}`);
    }
  }

  /**
   * Gerçek PostgreSQL bağlantısını ve migration durumunu canlı dener.
   * Servis kapalıysa veya ulaşılamıyorsa crash olmadan rapor üretir.
   */
  public static async probePostgres(databaseUrl: string, timeoutMs = 3000): Promise<{
    reachable: boolean;
    isSafeTestDb: boolean;
    dbName: string;
    port: number;
    error?: string;
    appliedMigrationsCount?: number;
    tables?: string[];
  }> {
    const validation = this.validateDatabaseUrl(databaseUrl);
    if (!validation.isSafe) {
      return {
        reachable: false,
        isSafeTestDb: false,
        dbName: validation.dbName,
        port: validation.port,
        error: validation.reason,
      };
    }

    const prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });

    try {
      // Timeout korumalı ping
      const pingPromise = prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 as result`;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`PostgreSQL bağlantısı ${timeoutMs}ms içinde zaman aşımına uğradı`)), timeoutMs),
      );

      await Promise.race([pingPromise, timeoutPromise]);

      // Migration tablosunu kontrol et
      let migrationCount = 0;
      try {
        const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
          SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
        `;
        migrationCount = migrations.length;
      } catch {
        migrationCount = 0;
      }

      // Tabloları listele
      const tableRows = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      `;
      const tables = tableRows.map((r) => r.tablename);

      await prisma.$disconnect();

      return {
        reachable: true,
        isSafeTestDb: true,
        dbName: validation.dbName,
        port: validation.port,
        appliedMigrationsCount: migrationCount,
        tables,
      };
    } catch (err: any) {
      await prisma.$disconnect().catch(() => {});
      return {
        reachable: false,
        isSafeTestDb: true,
        dbName: validation.dbName,
        port: validation.port,
        error: err.message || String(err),
      };
    }
  }

  /**
   * Gerçek Redis bağlantısını ve PING'i canlı dener.
   * Servis kapalıysa hata fırlatmadan rapor üretir.
   */
  public static async probeRedis(
    host: string,
    port: number,
    timeoutMs = 2500,
  ): Promise<{
    reachable: boolean;
    isSafeTestPort: boolean;
    host: string;
    port: number;
    error?: string;
    pingResponse?: string;
  }> {
    const validation = this.validateRedisConfig(host, port);

    return new Promise((resolve) => {
      let resolved = false;
      const client = new Redis({
        host,
        port,
        lazyConnect: true,
        connectTimeout: timeoutMs,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null, // Tekrar deneme yapma, hemen hata ver
      });

      // Unhandled error event uyarısını önle
      client.on('error', () => {});

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          client.disconnect();
          resolve({
            reachable: false,
            isSafeTestPort: validation.isSafe,
            host,
            port,
            error: `Redis bağlantısı ${timeoutMs}ms içinde zaman aşımına uğradı (${host}:${port})`,
          });
        }
      }, timeoutMs);

      client
        .connect()
        .then(async () => {
          const pong = await client.ping();
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            await client.quit();
            resolve({
              reachable: true,
              isSafeTestPort: validation.isSafe,
              host,
              port,
              pingResponse: pong,
            });
          }
        })
        .catch((err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            client.disconnect();
            resolve({
              reachable: false,
              isSafeTestPort: validation.isSafe,
              host,
              port,
              error: err.message || String(err),
            });
          }
        });
    });
  }
}
