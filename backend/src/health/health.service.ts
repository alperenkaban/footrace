import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export interface ServiceHealthStatus {
  status: 'up' | 'down';
  error?: string;
  responseTimeMs?: number;
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSeconds: number;
  services: {
    backend: ServiceHealthStatus;
    database: ServiceHealthStatus;
    redis: ServiceHealthStatus;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async checkDatabase(): Promise<ServiceHealthStatus> {
    const start = Date.now();
    try {
      // Read-only probe; does not mutate any application data
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'up',
        responseTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      this.logger.error(`Health database probe failed: ${err?.message || err}`);
      return {
        status: 'down',
        error: 'Database connectivity probe failed',
        responseTimeMs: Date.now() - start,
      };
    }
  }

  async checkRedis(): Promise<ServiceHealthStatus> {
    const start = Date.now();
    try {
      // Read-only probe; ping returns PONG
      const reply = await this.redisService.ping();
      if (reply === 'PONG') {
        return {
          status: 'up',
          responseTimeMs: Date.now() - start,
        };
      }
      return {
        status: 'down',
        error: 'Redis unexpected ping response',
        responseTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      this.logger.error(`Health Redis probe failed: ${err?.message || err}`);
      return {
        status: 'down',
        error: 'Redis connectivity probe failed',
        responseTimeMs: Date.now() - start,
      };
    }
  }

  async checkAll(): Promise<HealthCheckResult> {
    const [dbResult, redisResult] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const isDbUp = dbResult.status === 'up';
    const isRedisUp = redisResult.status === 'up';

    let overallStatus: 'ok' | 'degraded' | 'down';
    if (isDbUp && isRedisUp) {
      overallStatus = 'ok';
    } else if (isDbUp || isRedisUp) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'down';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      services: {
        backend: { status: 'up' },
        database: dbResult,
        redis: redisResult,
      },
    };
  }
}

