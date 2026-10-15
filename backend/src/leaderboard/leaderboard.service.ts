import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async getGlobalLeaderboard(limit = 100, type: 'rating' | 'wins' = 'rating') {
    const sortType = type === 'wins' ? 'wins' : 'rating';
    const cacheKey = `leaderboard:global:${sortType}:top_${limit}`;
    const cached = await this.redisService.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // Top players by rating or wins (BOTS EXCLUDED from competitive leaderboard)
    const orderByClause = sortType === 'wins'
      ? [{ wins: 'desc' as const }, { rating: 'desc' as const }]
      : [{ rating: 'desc' as const }, { wins: 'desc' as const }];

    const topPlayers = await this.prisma.playerProfile.findMany({
      where: {
        user: {
          isBot: false,
        },
      },
      orderBy: orderByClause,
      take: limit,
      select: {
        userId: true,
        rating: true,
        wins: true,
        user: {
          select: {
            email: true,
            isBot: true,
          },
        },
      },
    });

    // Format for frontend
    const leaderboard = topPlayers.map((p, index) => ({
      rank: index + 1,
      userId: p.userId,
      name: p.user.email ? p.user.email.split('@')[0] : `Guest_${p.userId.substring(0, 5)}`,
      isBot: p.user.isBot,
      rating: p.rating,
      wins: p.wins,
    }));

    // Cache in Redis for 30 seconds
    await this.redisService.set(cacheKey, JSON.stringify(leaderboard), 30);

    return leaderboard;
  }
}
