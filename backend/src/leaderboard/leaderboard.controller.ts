import { Controller, Get, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service.js';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  async getGlobalLeaderboard(@Query('limit') limitStr?: string) {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const data = await this.leaderboardService.getGlobalLeaderboard(limit);
    return { success: true, data };
  }
}
