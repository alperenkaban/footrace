import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

export interface WsRateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetMs: number;
}

@Injectable()
export class WsRateLimiterService {
  private readonly logger = new Logger(WsRateLimiterService.name);

  // In-memory fallback map: key -> { count: number, resetAt: number }
  private readonly inMemoryStore = new Map<string, { count: number; resetAt: number }>();

  // Varsayılan limitler
  public readonly connectionLimit = 15; // 10 saniyede IP başına maks 15 bağlantı
  public readonly connectionWindowSec = 10;

  public readonly messageLimit = 25; // 5 saniyede soket/kullanıcı başına maks 25 mesaj
  public readonly messageWindowSec = 5;

  // Kritik aksiyonlar için özel limitler
  public readonly actionLimits: Record<string, { limit: number; windowSec: number }> = {
    submit_answer: { limit: 5, windowSec: 3 }, // 3 saniyede maks 5 cevap denemesi
    join_matchmaking: { limit: 5, windowSec: 5 }, // 5 saniyede maks 5 kuyruk denemesi
    join_room: { limit: 6, windowSec: 5 }, // 5 saniyede maks 6 oda katılımı
    request_bot_match: { limit: 4, windowSec: 5 }, // 5 saniyede maks 4 bot maçı talebi
  };

  private cleanupTimer?: NodeJS.Timeout;

  constructor(@Optional() private readonly redisService?: RedisService) {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.inMemoryStore.entries()) {
        if (now > val.resetAt) {
          this.inMemoryStore.delete(key);
        }
      }
    }, 30000);

    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /**
   * IP bazlı bağlantı rate limit denetimi.
   */
  async consumeConnection(ip: string): Promise<WsRateLimitResult> {
    const raw = (ip || '').trim();
    const match = raw.match(/^[0-9a-fA-F:.]+/);
    const sanitizedIp = match ? match[0].replace(/[:.]+$/, '') : 'unknown';
    const key = `ws_rl:conn:${sanitizedIp || 'unknown'}`;
    return this.consume(key, this.connectionLimit, this.connectionWindowSec);
  }

  /**
   * Kullanıcı veya soket ID bazlı mesaj gönderim limit denetimi.
   */
  async consumeMessage(userIdOrSocketId: string, eventName?: string): Promise<WsRateLimitResult> {
    const baseId = (userIdOrSocketId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown';

    // Spesifik aksiyon limiti varsa önce onu kontrol et
    if (eventName && this.actionLimits[eventName]) {
      const { limit, windowSec } = this.actionLimits[eventName];
      const actionKey = `ws_rl:act:${eventName}:${baseId}`;
      const actionResult = await this.consume(actionKey, limit, windowSec);
      if (!actionResult.allowed) {
        return actionResult;
      }
    }

    // Genel mesaj rate limit kontrolü
    const generalKey = `ws_rl:msg:${baseId}`;
    return this.consume(generalKey, this.messageLimit, this.messageWindowSec);
  }

  /**
   * Redis atomik Lua script'i veya in-memory fallback ile sayaç artırma ve kontrol.
   */
  async consume(key: string, limit: number, windowSec: number): Promise<WsRateLimitResult> {
    // 1. Redis kullanılabilir durumdaysa atomik Lua script çalıştır
    if (this.redisService) {
      try {
        const client = this.redisService.getClient?.();
        if (client && typeof client.eval === 'function') {
          const luaScript = `
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
              redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            local ttl = redis.call('PTTL', KEYS[1])
            return { current, ttl }
          `;
          const raw: any = await client.eval(luaScript, 1, key, windowSec.toString());
          if (Array.isArray(raw)) {
            const current = Number(raw[0]);
            const ttlMs = Math.max(0, Number(raw[1]));
            return {
              allowed: current <= limit,
              current,
              limit,
              remaining: Math.max(0, limit - current),
              resetMs: ttlMs,
            };
          }
        }
      } catch (redisErr) {
        // Redis erişiminde hata olursa loglayıp in-memory fallback'e geç
        this.logger.debug?.(`Redis rate limit error, falling back to memory: ${(redisErr as Error).message}`);
      }
    }

    // 2. In-memory fallback
    const now = Date.now();
    const entry = this.inMemoryStore.get(key);

    if (!entry || now > entry.resetAt) {
      this.inMemoryStore.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      return {
        allowed: true,
        current: 1,
        limit,
        remaining: limit - 1,
        resetMs: windowSec * 1000,
      };
    }

    entry.count += 1;
    const remaining = Math.max(0, limit - entry.count);
    return {
      allowed: entry.count <= limit,
      current: entry.count,
      limit,
      remaining,
      resetMs: Math.max(0, entry.resetAt - now),
    };
  }

  /**
   * Test ve sıfırlama amaçlı bellek temizleme
   */
  reset(key?: string): void {
    if (key) {
      this.inMemoryStore.delete(key);
    } else {
      this.inMemoryStore.clear();
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}
