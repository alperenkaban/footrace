import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { DbBootstrapService } from './db-bootstrap.service.js';

@Global()
@Module({
  providers: [PrismaService, DbBootstrapService],
  exports: [PrismaService, DbBootstrapService],
})
export class PrismaModule {}
