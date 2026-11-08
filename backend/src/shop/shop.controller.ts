import { Controller, Get, Post, Body, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ShopService } from './shop.service.js';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import {
  BuyPackageDto,
  ClaimAdRewardDto,
  VerifyGooglePlayDto,
  VerifyAppleAppStoreDto,
  RestorePurchasesDto,
} from './dto/shop.dto.js';

@Controller('shop')
export class ShopController {
  constructor(
    private readonly shopService: ShopService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('packages')
  getPackages() {
    return {
      success: true,
      data: this.shopService.getPackages(),
    };
  }

  @Post('buy')
  async buyPackage(
    @Req() req: any,
    @Body() dto: BuyPackageDto,
  ) {
    const userId = this.extractUserId(req, dto.userId);
    if (!userId) {
      throw new UnauthorizedException('Kullanıcı girişi yapılmamış');
    }

    const result = await this.shopService.buyPackage(userId, dto.packageId);
    return {
      success: true,
      data: result,
    };
  }

  @Post('claim-ad-reward')
  async claimAdReward(
    @Req() req: any,
    @Body() dto: ClaimAdRewardDto,
  ) {
    const userId = this.extractUserId(req, dto.userId);
    if (!userId) {
      throw new UnauthorizedException('Kullanıcı girişi yapılmamış');
    }

    const result = await this.shopService.claimAdReward(userId);
    return {
      success: true,
      data: result,
    };
  }

  @Get('iap/products')
  getIapProducts() {
    return {
      success: true,
      data: this.shopService.getIapProducts(),
    };
  }

  @Get('iap/vip-status')
  async getVipStatus(@Req() req: any) {
    const userId = this.extractUserId(req);
    if (!userId) {
      return { success: true, data: { isVip: false } };
    }
    const status = await this.shopService.getVipStatus(userId);
    return {
      success: true,
      data: status,
    };
  }

  @Post('iap/google/verify')
  async verifyGooglePlay(
    @Req() req: any,
    @Body() dto: VerifyGooglePlayDto,
  ) {
    const userId = this.extractUserId(req, dto.userId);
    if (!userId) {
      throw new UnauthorizedException('Kullanıcı girişi yapılmamış');
    }

    const result = await this.shopService.verifyGooglePlayPurchase(userId, {
      productId: dto.productId,
      purchaseToken: dto.purchaseToken,
      orderId: dto.orderId,
    });

    return {
      success: true,
      data: result,
    };
  }

  @Post('iap/apple/verify')
  async verifyAppleAppStore(
    @Req() req: any,
    @Body() dto: VerifyAppleAppStoreDto,
  ) {
    const userId = this.extractUserId(req, dto.userId);
    if (!userId) {
      throw new UnauthorizedException('Kullanıcı girişi yapılmamış');
    }

    const result = await this.shopService.verifyAppleAppStorePurchase(userId, {
      productId: dto.productId,
      transactionId: dto.transactionId,
      receiptData: dto.receiptData,
    });

    return {
      success: true,
      data: result,
    };
  }

  @Post('iap/restore')
  async restorePurchases(@Req() req: any, @Body() dto: RestorePurchasesDto) {
    const userId = this.extractUserId(req, dto.userId);
    if (!userId) {
      throw new UnauthorizedException('Kullanıcı girişi yapılmamış');
    }

    const result = await this.shopService.restorePurchases(userId);
    return {
      success: true,
      data: result,
    };
  }

  private extractUserId(req: any, fallbackUserId?: string): string | null {
    // 1. Passport JWT user
    if (req.user?.userId) return req.user.userId;

    // 2. Bearer token in headers
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = this.jwtService.decode(token) as any;
        if (decoded?.sub) return decoded.sub;
      } catch {}
    }

    // 3. Fallback from body
    if (fallbackUserId) return fallbackUserId;

    return null;
  }
}
