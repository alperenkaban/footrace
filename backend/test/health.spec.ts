import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { HealthService } from '../src/health/health.service.js';
import { HealthController } from '../src/health/health.controller.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

describe('Health & Infrastructure Check Suite (Faz 6)', () => {
  let healthService: HealthService;
  let healthController: HealthController;
  let mockPrisma: Partial<PrismaService>;
  let mockRedis: Partial<RedisService>;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    };
    mockRedis = {
      ping: vi.fn().mockResolvedValue('PONG'),
    };

    healthService = new HealthService(
      mockPrisma as PrismaService,
      mockRedis as RedisService,
    );
    healthController = new HealthController(healthService);
  });

  describe('HealthService Probe Tests', () => {
    it('should report database as up when query succeeds', async () => {
      const dbStatus = await healthService.checkDatabase();
      expect(dbStatus.status).toBe('up');
      expect(dbStatus.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('should report database as down without leaking sensitive credentials on failure', async () => {
      (mockPrisma.$queryRaw as any).mockRejectedValueOnce(
        new Error('Connection failed: postgresql://root:secret_pass@127.0.0.1:5432/db')
      );

      const dbStatus = await healthService.checkDatabase();
      expect(dbStatus.status).toBe('down');
      expect(dbStatus.error).toBe('Database connectivity probe failed');
      expect(JSON.stringify(dbStatus)).not.toContain('secret_pass');
    });

    it('should report redis as up when ping returns PONG', async () => {
      const redisStatus = await healthService.checkRedis();
      expect(redisStatus.status).toBe('up');
      expect(redisStatus.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should report redis as down without leaking credentials when ping throws', async () => {
      (mockRedis.ping as any).mockRejectedValueOnce(
        new Error('ECONNREFUSED 127.0.0.1:6379 auth=redis_password_123')
      );

      const redisStatus = await healthService.checkRedis();
      expect(redisStatus.status).toBe('down');
      expect(redisStatus.error).toBe('Redis connectivity probe failed');
      expect(JSON.stringify(redisStatus)).not.toContain('redis_password_123');
    });

    it('should return overall status "ok" when all services are healthy', async () => {
      const result = await healthService.checkAll();
      expect(result.status).toBe('ok');
      expect(result.services.backend.status).toBe('up');
      expect(result.services.database.status).toBe('up');
      expect(result.services.redis.status).toBe('up');
      expect(typeof result.uptimeSeconds).toBe('number');
    });

    it('should return overall status "degraded" when database fails but redis is up', async () => {
      (mockPrisma.$queryRaw as any).mockRejectedValueOnce(new Error('DB Timeout'));
      const result = await healthService.checkAll();
      expect(result.status).toBe('degraded');
      expect(result.services.database.status).toBe('down');
      expect(result.services.redis.status).toBe('up');
    });

    it('should return overall status "degraded" when redis fails but database is up', async () => {
      (mockRedis.ping as any).mockRejectedValueOnce(new Error('Redis Timeout'));
      const result = await healthService.checkAll();
      expect(result.status).toBe('degraded');
      expect(result.services.database.status).toBe('up');
      expect(result.services.redis.status).toBe('down');
    });

    it('should return overall status "down" when both database and redis fail', async () => {
      (mockPrisma.$queryRaw as any).mockRejectedValueOnce(new Error('DB Timeout'));
      (mockRedis.ping as any).mockRejectedValueOnce(new Error('Redis Timeout'));
      const result = await healthService.checkAll();
      expect(result.status).toBe('down');
      expect(result.services.database.status).toBe('down');
      expect(result.services.redis.status).toBe('down');
    });
  });

  describe('HealthController Endpoint Tests', () => {
    it('GET /health: should return 200 OK when all services are up', async () => {
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
      };

      const result = await healthController.checkHealth(mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result.status).toBe('ok');
    });

    it('GET /health: should set status 503 SERVICE_UNAVAILABLE when degraded', async () => {
      (mockPrisma.$queryRaw as any).mockRejectedValueOnce(new Error('DB Down'));
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
      };

      const result = await healthController.checkHealth(mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(result.status).toBe('degraded');
    });

    it('GET /health/live: should return 200 OK with process uptime', () => {
      const result = healthController.checkLiveness();
      expect(result.status).toBe('ok');
      expect(typeof result.uptimeSeconds).toBe('number');
      expect(typeof result.timestamp).toBe('string');
    });
  });
});

