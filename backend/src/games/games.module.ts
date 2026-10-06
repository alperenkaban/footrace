import { Module } from '@nestjs/common';
import { GamesService } from './games.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { BotModule } from '../bot/bot.module.js';

@Module({
  imports: [WalletModule, BotModule],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
