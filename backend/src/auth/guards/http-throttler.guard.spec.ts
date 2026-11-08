import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpThrottlerGuard } from './http-throttler.guard.js';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

describe('HttpThrottlerGuard & Rate Limiting', () => {
  let guard: HttpThrottlerGuard;
  let storageService: ThrottlerStorageService;
  let reflector: Reflector;

  beforeEach(async () => {
    storageService = new ThrottlerStorageService();
    reflector = new Reflector();
    guard = new HttpThrottlerGuard(
      { throttlers: [{ name: 'default', ttl: 60000, limit: 2 }] },
      storageService,
      reflector,
    );
    await guard.onModuleInit();
  });

  it('should bypass throttling completely for WebSocket contexts', async () => {
    const wsContext: any = {
      getType: () => 'ws',
      switchToHttp: () => ({ getRequest: () => null, getResponse: () => null }),
      getClass: () => ({ name: 'GameGateway' }),
      getHandler: () => ({ name: 'handleJoinRoom' }),
    };

    const allowed = await guard.canActivate(wsContext);
    expect(allowed).toBe(true);
  });

  it('should accurately extract client IP from req.ips[0] when behind proxy', async () => {
    const reqWithProxy: any = {
      ips: ['203.0.113.195', '198.51.100.1'],
      ip: '198.51.100.1',
    };

    const tracker = await (guard as any).getTracker(reqWithProxy);
    expect(tracker).toBe('203.0.113.195');
  });

  it('should fallback to req.ip when req.ips is not present', async () => {
    const reqDirect: any = {
      ip: '192.168.1.100',
    };

    const tracker = await (guard as any).getTracker(reqDirect);
    expect(tracker).toBe('192.168.1.100');
  });

  it('should allow requests within limit and block with 429 when limit exceeded', async () => {
    const mockRequest: any = {
      ip: '10.0.0.42',
      headers: {},
      ips: [],
    };
    const mockResponse: any = {
      header: vi.fn(),
    };

    const httpContext: any = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getClass: () => ({ name: 'AuthController' }),
      getHandler: () => ({ name: 'guestLogin' }),
    };

    // Request 1: Allowed
    const firstAttempt = await guard.canActivate(httpContext);
    expect(firstAttempt).toBe(true);

    // Request 2: Allowed (Limit is 2)
    const secondAttempt = await guard.canActivate(httpContext);
    expect(secondAttempt).toBe(true);

    // Request 3: Throws ThrottlerException (429 Too Many Requests)
    await expect(guard.canActivate(httpContext)).rejects.toThrow();
  });
});
