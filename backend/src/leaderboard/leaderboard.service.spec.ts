import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LeaderboardService } from './leaderboard.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

describe('LeaderboardService — Unit & Filtering Tests', () => {
  let leaderboardService: LeaderboardService;
  let prismaMock: any;
  let redisMock: any;
  let redisStore: Map<string, string>;

  const mockProfiles = [
    {
      userId: 'human-1',
      rating: 1250,
      wins: 15,
      user: { email: 'lionel@barca.com', isBot: false },
    },
    {
      userId: 'human-2',
      rating: 1400,
      wins: 20,
      user: { email: 'cristiano@real.com', isBot: false },
    },
    {
      userId: 'human-3',
      rating: 1100,
      wins: 8,
      user: { email: null, isBot: false }, // Guest player
    },
    {
      userId: 'bot-1',
      rating: 9999, // Fake high rating
      wins: 999,
      user: { email: 'bot1@footquiz.local', isBot: true },
    },
    {
      userId: 'bot-2',
      rating: 1500,
      wins: 50,
      user: { email: 'bot2@footquiz.local', isBot: true },
    },
  ];

  beforeEach(() => {
    redisStore = new Map<string, string>();

    redisMock = {
      get: vi.fn(async (key: string) => redisStore.get(key) || null),
      set: vi.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };

    prismaMock = {
      playerProfile: {
        findMany: vi.fn().mockImplementation(async (args: any) => {
          // Filter out bots as specified in the Prisma where clause
          let result = mockProfiles.filter((p) => {
            if (args.where?.user?.isBot === false) {
              return p.user.isBot === false;
            }
            return true;
          });

          // Sort
          const order = args.orderBy || [];
          result.sort((a, b) => {
            for (const clause of order) {
              if (clause.rating) {
                const diff = clause.rating === 'desc' ? b.rating - a.rating : a.rating - b.rating;
                if (diff !== 0) return diff;
              }
              if (clause.wins) {
                const diff = clause.wins === 'desc' ? b.wins - a.wins : a.wins - b.wins;
                if (diff !== 0) return diff;
              }
            }
            return 0;
          });

          if (args.take) {
            result = result.slice(0, args.take);
          }

          return result;
        }),
      },
    };

    leaderboardService = new LeaderboardService(
      prismaMock as unknown as PrismaService,
      redisMock as unknown as RedisService,
    );
  });

  it('bot oyuncular rekabetçi liderlik tablosundan kesinlikle elenmeli, yalnızca gerçek oyuncular listelenmelidir', async () => {
    const leaderboard = await leaderboardService.getGlobalLeaderboard(10, 'rating');

    // 1. Botların bulunmadığı doğrulanmalı
    const botEntries = leaderboard.filter((item: any) => item.isBot === true || item.userId.startsWith('bot-'));
    expect(botEntries).toHaveLength(0);

    // 2. Yalnızca 3 insan oyuncu dönmeli
    expect(leaderboard).toHaveLength(3);
    expect(leaderboard.map((p: any) => p.userId)).toEqual(['human-2', 'human-1', 'human-3']);
  });

  it('rating sıralamasında en yüksek puana sahip oyuncular en üstte yer almalı ve rank numaraları 1-based olmalıdır', async () => {
    const leaderboard = await leaderboardService.getGlobalLeaderboard(10, 'rating');

    expect(leaderboard[0]).toEqual({
      rank: 1,
      userId: 'human-2',
      name: 'cristiano',
      isBot: false,
      rating: 1400,
      wins: 20,
    });

    expect(leaderboard[1]).toEqual({
      rank: 2,
      userId: 'human-1',
      name: 'lionel',
      isBot: false,
      rating: 1250,
      wins: 15,
    });

    expect(leaderboard[2]).toEqual({
      rank: 3,
      userId: 'human-3',
      name: 'Guest_human',
      isBot: false,
      rating: 1100,
      wins: 8,
    });
  });

  it('wins sıralamasında en çok galibiyete sahip oyuncular en üstte yer almalıdır', async () => {
    const leaderboard = await leaderboardService.getGlobalLeaderboard(10, 'wins');

    expect(leaderboard[0].userId).toBe('human-2'); // 20 wins
    expect(leaderboard[1].userId).toBe('human-1'); // 15 wins
    expect(leaderboard[2].userId).toBe('human-3'); // 8 wins
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[2].rank).toBe(3);
  });

  it('liderlik sonuçları Redis önbelleğinden servis edilmeli ve 30 saniye TTL ile saklanmalıdır', async () => {
    // 1. İlk çağrı -> DB'ye gider ve Redis'e yazar
    const result1 = await leaderboardService.getGlobalLeaderboard(10, 'rating');
    expect(prismaMock.playerProfile.findMany).toHaveBeenCalledTimes(1);
    expect(redisMock.set).toHaveBeenCalledWith(
      'leaderboard:global:rating:top_10',
      JSON.stringify(result1),
      30,
    );

    // 2. İkinci çağrı -> Redis cache'ten döner, DB'ye gitmez
    const result2 = await leaderboardService.getGlobalLeaderboard(10, 'rating');
    expect(prismaMock.playerProfile.findMany).toHaveBeenCalledTimes(1); // Call count değişmemeli
    expect(result2).toEqual(result1);
  });

  it('Redis hatası durumunda çökmeden doğrudan veritabanından veri çekebilmelidir', async () => {
    redisMock.get.mockRejectedValueOnce(new Error('Redis connection refused'));
    redisMock.set.mockRejectedValueOnce(new Error('Redis connection refused'));

    const leaderboard = await leaderboardService.getGlobalLeaderboard(10, 'rating');
    expect(leaderboard).toHaveLength(3);
    expect(leaderboard[0].userId).toBe('human-2');
  });
});
