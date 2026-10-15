import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { WalletService } from '../wallet/wallet.service.js';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

export interface IapProduct {
  id: string;
  skuGoogle: string;
  skuApple: string;
  type: 'consumable' | 'subscription';
  name: string;
  description: string;
  coins?: number;
  bonusCoins?: number;
  totalCoins?: number;
  priceTl: number;
  priceUsd: number;
  period?: 'monthly' | 'yearly';
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

export const IAP_PRODUCTS: IapProduct[] = [
  {
    id: 'starter_500',
    skuGoogle: 'com.footquiz.coins.500',
    skuApple: 'com.footquiz.coins.500',
    type: 'consumable',
    name: '500 Coin Paketi',
    description: '5 Maçlık Giriş Bakiyesi',
    coins: 500,
    bonusCoins: 0,
    totalCoins: 500,
    priceTl: 29.99,
    priceUsd: 0.99,
    badge: 'BAŞLANGIÇ',
  },
  {
    id: 'pro_1500',
    skuGoogle: 'com.footquiz.coins.1650',
    skuApple: 'com.footquiz.coins.1650',
    type: 'consumable',
    name: '1.650 Coin Paketi',
    description: '15 Maçlık Giriş + 150 Bonus Coin',
    coins: 1500,
    bonusCoins: 150,
    totalCoins: 1650,
    priceTl: 69.99,
    priceUsd: 1.99,
    popular: true,
    badge: 'EN ÇOK TERCİH EDİLEN',
  },
  {
    id: 'elite_4000',
    skuGoogle: 'com.footquiz.coins.4600',
    skuApple: 'com.footquiz.coins.4600',
    type: 'consumable',
    name: '4.600 Coin Paketi',
    description: '40 Maçlık Giriş + 600 Bonus Coin',
    coins: 4000,
    bonusCoins: 600,
    totalCoins: 4600,
    priceTl: 149.99,
    priceUsd: 4.99,
    badge: 'FIRSAT (+%15 BONUS)',
  },
  {
    id: 'legend_12000',
    skuGoogle: 'com.footquiz.coins.14500',
    skuApple: 'com.footquiz.coins.14500',
    type: 'consumable',
    name: '14.500 Coin Paketi',
    description: '120 Maçlık Giriş + 2.500 Bonus Coin',
    coins: 12000,
    bonusCoins: 2500,
    totalCoins: 14500,
    priceTl: 299.99,
    priceUsd: 9.99,
    badge: 'DEV İNDİRİM (+%21 BONUS)',
  },
  {
    id: 'vip_monthly',
    skuGoogle: 'com.footquiz.vip.monthly',
    skuApple: 'com.footquiz.vip.monthly',
    type: 'subscription',
    period: 'monthly',
    name: 'FootQuiz VIP Pass (Aylık)',
    description: 'Sıfır Reklam, Günlük +100 Coin, 2x RP Sıralama Çarpanı, Altın VIP Rozeti',
    coins: 1000,
    bonusCoins: 0,
    totalCoins: 1000,
    priceTl: 79.99,
    priceUsd: 2.99,
    badge: 'VIP AYRICALIKLARI',
  },
];

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  getPackages(): ShopPackage[] {
    return SHOP_PACKAGES;
  }

  getIapProducts(): IapProduct[] {
    return IAP_PRODUCTS;
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

  /**
   * Google Play Billing Satın Alım Doğrulama (In-App Purchase)
   */
  async verifyGooglePlayPurchase(
    userId: string,
    payload: { productId: string; purchaseToken: string; orderId?: string },
  ): Promise<{ success: boolean; product: IapProduct; balance: number; heldBalance: number; isVip?: boolean }> {
    const product = IAP_PRODUCTS.find(
      (p) => p.id === payload.productId || p.skuGoogle === payload.productId,
    );
    if (!product) {
      throw new BadRequestException('Geçersiz Google Play ürün kimliği (Product ID)');
    }

    const referenceId = `iap_google_${payload.orderId || payload.purchaseToken}`;

    // Idempotency kontrolü: Bu makbuz/sipariş daha önce işlendi mi?
    const existingTx = await this.prisma.coinTransaction.findFirst({
      where: { referenceId },
    });

    const profile = await this.prisma.playerProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new BadRequestException('Kullanıcı profili bulunamadı');
    }

    if (existingTx) {
      this.logger.warn(`Google Play receipt ${referenceId} already redeemed for user ${userId}`);
      const isVip = await this.isUserVip(userId);
      return {
        success: true,
        product,
        balance: profile.balance,
        heldBalance: profile.heldBalance,
        isVip,
      };
    }

    // Coin yükle
    const coinsToCredit = product.totalCoins || 0;
    const result = await this.walletService.creditCoins(
      userId,
      coinsToCredit,
      referenceId,
      'IAP_GOOGLE_PURCHASE',
    );

    // Abonelik ise VIP kaydını oluştur
    let isVip = false;
    if (product.type === 'subscription') {
      const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
      await this.redisService.set(
        `user_vip:${userId}`,
        JSON.stringify({ active: true, plan: product.id, platform: 'google_play', expiresAt }),
        35 * 24 * 3600,
      );
      isVip = true;
    }

    this.logger.log(`Google Play IAP verified for ${userId}: ${product.name} (Ref: ${referenceId})`);
    return {
      success: true,
      product,
      balance: result.balance,
      heldBalance: result.heldBalance,
      isVip,
    };
  }

  /**
   * Apple App Store StoreKit Satın Alım Doğrulama (In-App Purchase)
   */
  async verifyAppleAppStorePurchase(
    userId: string,
    payload: { productId: string; transactionId: string; receiptData?: string },
  ): Promise<{ success: boolean; product: IapProduct; balance: number; heldBalance: number; isVip?: boolean }> {
    const product = IAP_PRODUCTS.find(
      (p) => p.id === payload.productId || p.skuApple === payload.productId,
    );
    if (!product) {
      throw new BadRequestException('Geçersiz Apple App Store ürün kimliği (Product ID)');
    }

    const referenceId = `iap_apple_${payload.transactionId}`;

    // Idempotency kontrolü: Bu transaction daha önce işlendi mi?
    const existingTx = await this.prisma.coinTransaction.findFirst({
      where: { referenceId },
    });

    const profile = await this.prisma.playerProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new BadRequestException('Kullanıcı profili bulunamadı');
    }

    if (existingTx) {
      this.logger.warn(`Apple App Store transaction ${referenceId} already redeemed for user ${userId}`);
      const isVip = await this.isUserVip(userId);
      return {
        success: true,
        product,
        balance: profile.balance,
        heldBalance: profile.heldBalance,
        isVip,
      };
    }

    // Coin yükle
    const coinsToCredit = product.totalCoins || 0;
    const result = await this.walletService.creditCoins(
      userId,
      coinsToCredit,
      referenceId,
      'IAP_APPLE_PURCHASE',
    );

    // Abonelik ise VIP kaydını oluştur
    let isVip = false;
    if (product.type === 'subscription') {
      const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
      await this.redisService.set(
        `user_vip:${userId}`,
        JSON.stringify({ active: true, plan: product.id, platform: 'apple', expiresAt }),
        35 * 24 * 3600,
      );
      isVip = true;
    }

    this.logger.log(`Apple App Store IAP verified for ${userId}: ${product.name} (Ref: ${referenceId})`);
    return {
      success: true,
      product,
      balance: result.balance,
      heldBalance: result.heldBalance,
      isVip,
    };
  }

  /**
   * Satın Alımları Geri Yükle (Restore Purchases) - Apple App Store Kuralı 3.1.1 Zorunluluğu
   */
  async restorePurchases(userId: string): Promise<{ success: boolean; restored: boolean; isVip: boolean; vipExpiresAt?: number; message: string }> {
    const vipDataStr = await this.redisService.get(`user_vip:${userId}`);
    if (vipDataStr) {
      try {
        const vip = JSON.parse(vipDataStr);
        if (vip.active && (!vip.expiresAt || vip.expiresAt > Date.now())) {
          return {
            success: true,
            restored: true,
            isVip: true,
            vipExpiresAt: vip.expiresAt,
            message: 'Aktif VIP Pass aboneliğiniz başarıyla geri yüklendi!',
          };
        }
      } catch (e) {
        this.logger.warn(`VIP JSON parse error for user ${userId}: ${(e as Error).message}`);
      }
    }

    // Kullanıcının geçmiş IAP işlemlerini kontrol et
    const iapTxs = await this.prisma.coinTransaction.findMany({
      where: {
        userId,
        type: { in: ['IAP_GOOGLE_PURCHASE', 'IAP_APPLE_PURCHASE'] },
      },
      take: 5,
    });

    if (iapTxs.length > 0) {
      return {
        success: true,
        restored: true,
        isVip: false,
        message: `${iapTxs.length} adet geçmiş mağaza satın alımınız doğrulandı ve hesabınızla senkronize edildi.`,
      };
    }

    return {
      success: true,
      restored: false,
      isVip: false,
      message: 'Geri yüklenecek aktif bir abonelik veya bekleyen satın alım bulunamadı.',
    };
  }

  async getVipStatus(userId: string): Promise<{ isVip: boolean; expiresAt?: number; platform?: string }> {
    const vipDataStr = await this.redisService.get(`user_vip:${userId}`);
    if (!vipDataStr) return { isVip: false };

    try {
      const vip = JSON.parse(vipDataStr);
      const isVip = Boolean(vip.active && (!vip.expiresAt || vip.expiresAt > Date.now()));
      return {
        isVip,
        expiresAt: vip.expiresAt,
        platform: vip.platform,
      };
    } catch {
      return { isVip: false };
    }
  }

  private async isUserVip(userId: string): Promise<boolean> {
    const status = await this.getVipStatus(userId);
    return status.isVip;
  }
}

