import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  // Temel Redis operasyonları
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redisClient.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redisClient.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.redisClient.get(key);
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key);
  }

  // Matchmaking (List veya Sorted Set kullanılabilir)
  // MVP aşamasında basit bir kuyruk (List) kullanıyoruz
  async enqueuePlayer(queueName: string, userId: string): Promise<void> {
    // Aynı oyuncu kuyrukta iki kez olmamalı
    const inQueue = await this.redisClient.lrange(queueName, 0, -1);
    if (!inQueue.includes(userId)) {
      await this.redisClient.rpush(queueName, userId);
    }
  }

  async dequeuePlayers(queueName: string, count: number): Promise<string[]> {
    // Aynı anda birden fazla oyuncuyu kuyruktan güvenle almak için transaction/Lua kullanılabilir.
    // MVP aşamasında temel pop işlemi yapıyoruz.
    const players: string[] = [];
    for (let i = 0; i < count; i++) {
      const player = await this.redisClient.lpop(queueName);
      if (player) {
        players.push(player);
      } else {
        break; // Kuyrukta yeterli oyuncu yoksa işlemi kes
      }
    }
    
    // Eğer istenen sayıya ulaşılamadıysa (örn 2 kişi lazımdı 1 kişi çıktı)
    // O 1 kişiyi tekrar kuyruğun en başına koymalıyız.
    if (players.length > 0 && players.length < count) {
      // Reverse edip lpush ile geri koyuyoruz
      for (const p of players.reverse()) {
        await this.redisClient.lpush(queueName, p);
      }
      return [];
    }

    return players;
  }
  
  async removeFromQueue(queueName: string, userId: string): Promise<void> {
    await this.redisClient.lrem(queueName, 0, userId);
  }
}
