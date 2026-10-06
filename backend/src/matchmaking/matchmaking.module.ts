import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service.js';
import { GamesModule } from '../games/games.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { BotModule } from '../bot/bot.module.js';

@Module({
  imports: [GamesModule, WalletModule, BotModule],
  providers: [MatchmakingService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
