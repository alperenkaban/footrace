import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway.js';
import { MatchmakingModule } from '../matchmaking/matchmaking.module.js';
import { GamesModule } from '../games/games.module.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [MatchmakingModule, GamesModule, AuthModule],
  providers: [GameGateway],
})
export class GatewayModule {}
