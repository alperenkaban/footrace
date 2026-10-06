import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async createGuestUser(displayName?: string) {
    try {
      // Rastgele email/username atıyoruz guest için
      const uniqueId = Math.random().toString(36).substring(2, 10);
      const guestEmail = `guest_${uniqueId}@footquiz.local`;

      const user = await this.prisma.user.create({
        data: {
          email: guestEmail,
          isGuest: true,
          profile: {
            create: {
              rating: 1000,
              balance: 500, // 500 başlangıç coini
              heldBalance: 0,
            },
          },
        },
        include: { profile: true },
      });

      const payload = { sub: user.id, isGuest: true };
      const access_token = this.jwtService.sign(payload);

      return {
        access_token,
        user: {
          id: user.id,
          isGuest: true,
          displayName: displayName || `Guest_${uniqueId}`,
          balance: user.profile?.balance || 500,
          heldBalance: user.profile?.heldBalance || 0,
          rating: user.profile?.rating || 1000,
        },
      };
    } catch (error) {
      throw new InternalServerErrorException('Guest user creation failed');
    }
  }

  async validateSocialLogin(provider: 'google' | 'facebook', profile: any) {
    const { id, emails, displayName } = profile;
    const email = emails && emails.length > 0 ? emails[0].value : null;

    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: provider === 'google' ? id : undefined },
          { facebookId: provider === 'facebook' ? id : undefined },
          { email: email || undefined }, // Email'den match
        ],
      },
      include: { profile: true },
    });

    if (!user) {
      // Yeni kullanıcı oluştur
      user = await this.prisma.user.create({
        data: {
          email: email,
          isGuest: false,
          googleId: provider === 'google' ? id : null,
          facebookId: provider === 'facebook' ? id : null,
          profile: {
            create: {
              rating: 1000,
              balance: 1000, // Sosyal girişe 1000 başlangıç coini
              heldBalance: 0,
            },
          },
        },
        include: { profile: true },
      });
    } else {
      // Mevcut kullanıcının Social ID'lerini güncelle (Eğer email ile eşleştiyse)
      if (provider === 'google' && !user.googleId) {
        await this.prisma.user.update({ where: { id: user.id }, data: { googleId: id, isGuest: false } });
      }
      if (provider === 'facebook' && !user.facebookId) {
        await this.prisma.user.update({ where: { id: user.id }, data: { facebookId: id, isGuest: false } });
      }
    }

    const payload = { sub: user.id, isGuest: false };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: user.id,
        isGuest: false,
        displayName: displayName || email || 'Oyuncu',
        balance: user.profile?.balance || 0,
        heldBalance: user.profile?.heldBalance || 0,
        rating: user.profile?.rating || 1000,
      },
    };
  }
}
