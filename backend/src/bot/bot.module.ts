import { Module } from '@nestjs/common';
import { BotService } from './bot.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
