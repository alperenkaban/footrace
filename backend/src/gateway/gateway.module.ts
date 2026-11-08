import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway.js';
import { WsRateLimiterService } from './ws-rate-limiter.service.js';
import { MatchmakingModule } from '../matchmaking/matchmaking.module.js';
import { GamesModule } from '../games/games.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [MatchmakingModule, GamesModule, AuthModule],
  providers: [GameGateway, WsRateLimiterService],
  exports: [GameGateway, WsRateLimiterService],
})
export class GatewayModule {}
