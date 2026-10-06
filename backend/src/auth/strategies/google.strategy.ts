import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID') || 'dummy-google-client-id',
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET') || 'dummy-google-secret',
      callbackURL: configService.get('BACKEND_URL') ? `${configService.get('BACKEND_URL')}/auth/google/callback` : 'http://localhost:4000/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
    // AuthServise yönlendirilmek üzere profili paslıyoruz
    done(null, profile);
  }
}
