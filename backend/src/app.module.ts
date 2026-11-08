import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { ShopModule } from './shop/shop.module.js';
import { HealthModule } from './health/health.module.js';
import { HttpThrottlerGuard } from './auth/guards/http-throttler.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 dakika (60.000 ms)
        limit: 60,  // IP başına dakikada 60 istek
      },
    ]),
    RedisModule,
    PrismaModule,
    GamesModule,
    MatchmakingModule,
    GatewayModule,
    AuthModule,
    WalletModule,
    BotModule,
    LeaderboardModule,
    ShopModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: HttpThrottlerGuard,
    },
  ],
})
export class AppModule {}
