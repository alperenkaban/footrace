import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthGuard } from '@nestjs/passport';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('guest')
  async guestLogin(@Body('displayName') displayName: string) {
    return this.authService.createGuestUser(displayName);
  }

  // --- Google OAuth ---
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req: any) {
    // Guards will handle the redirect
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: any) {
    return this.authService.validateSocialLogin('google', req.user);
  }

  // --- Facebook OAuth ---
  @Get('facebook')
  @UseGuards(AuthGuard('facebook'))
  async facebookAuth(@Req() req: any) {
    // Guards will handle the redirect
  }

  @Get('facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  async facebookAuthRedirect(@Req() req: any) {
    return this.authService.validateSocialLogin('facebook', req.user);
  }
}
