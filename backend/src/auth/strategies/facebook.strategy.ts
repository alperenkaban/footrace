import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-facebook';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('FACEBOOK_CLIENT_ID') || 'dummy-facebook-client-id',
      clientSecret: configService.get('FACEBOOK_CLIENT_SECRET') || 'dummy-facebook-secret',
      callbackURL: configService.get('BACKEND_URL') ? `${configService.get('BACKEND_URL')}/auth/facebook/callback` : 'http://localhost:4000/auth/facebook/callback',
      profileFields: ['id', 'emails', 'name', 'displayName'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: (err: any, user: any, info?: any) => void): Promise<any> {
    done(null, profile);
  }
}
