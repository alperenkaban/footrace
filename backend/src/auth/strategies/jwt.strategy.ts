import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateAndGetJwtSecret } from '../jwt.config.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: validateAndGetJwtSecret(configService.get<string>('JWT_SECRET')),
    });
  }

  async validate(payload: any) {
    return { userId: payload.sub, isGuest: payload.isGuest };
  }
}
