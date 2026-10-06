import { Module } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service.js';
import { LeaderboardController } from './leaderboard.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
})
export class LeaderboardModule {}
