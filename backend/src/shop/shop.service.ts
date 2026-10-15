import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { WalletService } from '../wallet/wallet.service.js';
import { RedisService } from '../redis/redis.service.js';
import { v4 as uuidv4 } from 'uuid';

export interface ShopPackage {
  id: string;
  name: string;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  priceTl: number;
  badge?: string;
  popular?: boolean;
}

export const SHOP_PACKAGES: ShopPackage[] = [
  {
    id: 'starter_500',
    name: 'Başlangıç Paketi',
    coins: 500,
    bonusCoins: 0,
    totalCoins: 500,
    priceTl: 29.99,
    badge: 'POPÜLER',
  },
  {
    id: 'pro_1500',
    name: 'Pro Oyuncu Paketi',
    coins: 1500,
    bonusCoins: 150,
    totalCoins: 1650,
    priceTl: 69.99,
    popular: true,
    badge: 'EN ÇOK TERCİH EDİLEN',
  },
  {
    id: 'elite_4000',
    name: 'Yıldız Paketi',
    coins: 4000,
    bonusCoins: 600,
    totalCoins: 4600,
    priceTl: 149.99,
    badge: 'FIRSAT (+%15 BONUS)',
  },
  {
    id: 'legend_12000',
    name: 'Efsane Paketi',
    coins: 12000,
    bonusCoins: 2500,
    totalCoins: 14500,
    priceTl: 299.99,
    badge: 'DEV İNDİRİM (+%21 BONUS)',
  },
];

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly redisService: RedisService,
  ) {}

  getPackages(): ShopPackage[] {
    return SHOP_PACKAGES;
  }

  async buyPackage(userId: string, packageId: string): Promise<{ success: boolean; package: ShopPackage; balance: number; heldBalance: number }> {
    const pkg = SHOP_PACKAGES.find((p) => p.id === packageId);
    if (!pkg) {
      throw new BadRequestException('Geçersiz paket seçildi');
    }

    const transactionRef = `shop_${packageId}_${uuidv4()}`;
    const result = await this.walletService.creditCoins(
      userId,
      pkg.totalCoins,
      transactionRef,
      'SHOP_PURCHASE',
    );

    this.logger.log(`User ${userId} purchased ${pkg.name} (${pkg.totalCoins} coins)`);
    return {
      success: true,
      package: pkg,
      balance: result.balance,
      heldBalance: result.heldBalance,
    };
  }

  async claimAdReward(userId: string): Promise<{ success: boolean; coinsAwarded: number; balance: number; heldBalance: number }> {
    const cooldownKey = `user_ad_cooldown:${userId}`;
    const inCooldown = await this.redisService.get(cooldownKey);
    if (inCooldown) {
      throw new BadRequestException('Lütfen yeni bir reklam izlemeden önce 15 saniye bekleyin.');
    }

    const rewardCoins = 50;
    const transactionRef = `ad_reward_${uuidv4()}`;
    const result = await this.walletService.creditCoins(
      userId,
      rewardCoins,
      transactionRef,
      'DAILY_REWARD',
    );

    // 15 saniye cooldown belirle
    await this.redisService.set(cooldownKey, '1', 15);

    this.logger.log(`User ${userId} claimed ad reward (+${rewardCoins} coins)`);
    return {
      success: true,
      coinsAwarded: rewardCoins,
      balance: result.balance,
      heldBalance: result.heldBalance,
    };
  }
}
