import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsRateLimiterService } from './ws-rate-limiter.service.js';

describe('WsRateLimiterService - WebSocket Rate Limiting', () => {
  let service: WsRateLimiterService;
  let mockRedisService: any;
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      eval: vi.fn(),
    };
    mockRedisService = {
      getClient: vi.fn().mockReturnValue(mockRedisClient),
    };
    service = new WsRateLimiterService(mockRedisService);
  });

  afterEach(() => {
    service.destroy();
  });

  describe('IP Connection Rate Limiting', () => {
    it('should sanitize IP addresses and allow connections within limit', async () => {
      mockRedisClient.eval.mockResolvedValue([1, 10000]); // current: 1, ttl: 10s

      const result = await service.consumeConnection('192.168.1.100');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(service.connectionLimit - 1);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        'ws_rl:conn:192.168.1.100',
        service.connectionWindowSec.toString(),
      );
    });

    it('should block connection attempts exceeding limit', async () => {
      mockRedisClient.eval.mockResolvedValue([service.connectionLimit + 1, 8000]);

      const result = await service.consumeConnection('10.0.0.5');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.current).toBe(service.connectionLimit + 1);
    });

    it('should sanitize dangerous characters in IP address (injection prevention)', async () => {
      mockRedisClient.eval.mockResolvedValue([1, 10000]);

      await service.consumeConnection('127.0.0.1; DROP KEY *; \r\n');
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.anything(),
        1,
        'ws_rl:conn:127.0.0.1',
        service.connectionWindowSec.toString(),
      );
    });
  });

  describe('Message Rate Limiting & Action Limits', () => {
    it('should allow normal message rates per user', async () => {
      mockRedisClient.eval.mockResolvedValue([5, 5000]);

      const result = await service.consumeMessage('user-abc');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(5);
      expect(result.remaining).toBe(service.messageLimit - 5);
    });

    it('should apply specific stricter limits for submit_answer action', async () => {
      const actionConfig = service.actionLimits['submit_answer'];
      expect(actionConfig).toBeDefined();

      // Simulate exceeding submit_answer limit
      mockRedisClient.eval.mockResolvedValue([actionConfig.limit + 1, 2000]);

      const result = await service.consumeMessage('user-spammer', 'submit_answer');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(actionConfig.limit + 1);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.anything(),
        1,
        'ws_rl:act:submit_answer:user-spammer',
        actionConfig.windowSec.toString(),
      );
    });

    it('should block general message flooding when user spams generic events', async () => {
      mockRedisClient.eval.mockResolvedValue([service.messageLimit + 1, 4000]);

      const result = await service.consumeMessage('user-flood');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(service.messageLimit + 1);
    });
  });

  describe('Redis Resilience & In-Memory Fallback', () => {
    it('should seamlessly fall back to in-memory store when Redis throws an error', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection refused'));

      // Service should not throw, should use internal inMemoryStore
      const res1 = await service.consume('test_key', 2, 10);
      expect(res1.allowed).toBe(true);
      expect(res1.current).toBe(1);

      const res2 = await service.consume('test_key', 2, 10);
      expect(res2.allowed).toBe(true);
      expect(res2.current).toBe(2);

      // Third request should be blocked by in-memory limiter
      const res3 = await service.consume('test_key', 2, 10);
      expect(res3.allowed).toBe(false);
      expect(res3.current).toBe(3);
    });

    it('should work without RedisService (standalone in-memory mode)', async () => {
      const standalone = new WsRateLimiterService(undefined);

      for (let i = 1; i <= 3; i++) {
        const res = await standalone.consume('mem_test', 3, 5);
        expect(res.allowed).toBe(true);
        expect(res.current).toBe(i);
      }

      const blocked = await standalone.consume('mem_test', 3, 5);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);

      standalone.destroy();
    });

    it('should correctly reset in-memory counters on demand', async () => {
      const standalone = new WsRateLimiterService(undefined);

      await standalone.consume('key_to_reset', 1, 10);
      expect((await standalone.consume('key_to_reset', 1, 10)).allowed).toBe(false);

      standalone.reset('key_to_reset');
      expect((await standalone.consume('key_to_reset', 1, 10)).allowed).toBe(true);

      standalone.destroy();
    });
  });
});
