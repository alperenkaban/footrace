import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisModule } from './redis/redis.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { GamesModule } from './games/games.module.js';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { WalletModule } from './wallet/wallet.module.js';
import { BotModule } from './bot/bot.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    PrismaModule,
    GamesModule,
    MatchmakingModule,
    GatewayModule,
    AuthModule,
    WalletModule,
    BotModule,
    LeaderboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
