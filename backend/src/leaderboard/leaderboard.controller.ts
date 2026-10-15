import { Controller, Get, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service.js';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  async getGlobalLeaderboard(
    @Query('limit') limitStr?: string,
    @Query('type') type?: 'rating' | 'wins',
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const sortType = type === 'wins' ? 'wins' : 'rating';
    const data = await this.leaderboardService.getGlobalLeaderboard(limit, sortType);
    return { success: true, data, type: sortType };
  }
}
