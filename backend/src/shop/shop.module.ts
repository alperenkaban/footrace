import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller.js';
import { ShopService } from './shop.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateAndGetJwtSecret } from '../auth/jwt.config.js';

@Module({
  imports: [
    WalletModule,
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: validateAndGetJwtSecret(config.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [ShopController],
  providers: [ShopService],
  exports: [ShopService],
})
export class ShopModule {}
