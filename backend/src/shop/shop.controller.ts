import { Controller, Get, Post, Body, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ShopService } from './shop.service.js';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';

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
    @Body('packageId') packageId: string,
    @Body('userId') bodyUserId?: string,
  ) {
    const userId = this.extractUserId(req, bodyUserId);
    if (!userId) {
      throw new UnauthorizedException('Kullanıcı girişi yapılmamış');
    }

    const result = await this.shopService.buyPackage(userId, packageId);
    return {
      success: true,
      data: result,
    };
  }

  @Post('claim-ad-reward')
  async claimAdReward(
    @Req() req: any,
    @Body('userId') bodyUserId?: string,
  ) {
    const userId = this.extractUserId(req, bodyUserId);
    if (!userId) {
      throw new UnauthorizedException('Kullanıcı girişi yapılmamış');
    }

    const result = await this.shopService.claimAdReward(userId);
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
