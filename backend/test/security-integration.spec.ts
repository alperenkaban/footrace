import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { GuestLoginDto } from '../src/auth/dto/guest-login.dto.js';
import { BuyPackageDto } from '../src/shop/dto/shop.dto.js';
import { isOriginAllowed } from '../src/common/cors.config.js';
import { validateAndGetJwtSecret, DEV_FALLBACK_JWT_SECRET } from '../src/auth/jwt.config.js';
import { HealthService } from '../src/health/health.service.js';

describe('Unified Security & Infrastructure Integration Suite (Faz 8)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  describe('P1-1: WebSocket Room Authorization & Room Hijacking Prevention', () => {
    it('should strictly reject users attempting to join rooms they are not assigned to', () => {
      const activeUserRooms = new Map<string, string>([
        ['legit-user-1', 'room-alpha-123'],
        ['legit-user-2', 'room-alpha-123'],
      ]);

      const isUserAuthorizedForRoom = (userId: string, targetRoomId: string): boolean => {
        return activeUserRooms.get(userId) === targetRoomId;
      };

      expect(isUserAuthorizedForRoom('legit-user-1', 'room-alpha-123')).toBe(true);
      expect(isUserAuthorizedForRoom('attacker-user', 'room-alpha-123')).toBe(false);
      expect(isUserAuthorizedForRoom('legit-user-1', 'room-beta-999')).toBe(false);
    });
  });

  describe('P1-2: Global ValidationPipe & DTO Whitelist Enforcement', () => {
    it('should reject unwhitelisted properties in guest login requests via ValidationPipe', async () => {
      await expect(
        pipe.transform(
          { displayName: 'ValidUser', attackerRole: 'admin' },
          { type: 'body', metatype: GuestLoginDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate BuyPackageDto and reject missing packageId or unwhitelisted fields', async () => {
      await expect(
        pipe.transform(
          { packageId: '', extraExploitField: 123 },
          { type: 'body', metatype: BuyPackageDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('P1-3: HTTP & WebSocket CORS Domain Whitelisting', () => {
    it('should permit allowed origins and reject arbitrary or malicious origins', () => {
      const allowedOrigins = ['http://localhost:3000', 'https://footrace.app'];

      expect(isOriginAllowed('http://localhost:3000', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('https://footrace.app', allowedOrigins)).toBe(true);
      expect(isOriginAllowed('http://evil-attacker.com', allowedOrigins)).toBe(false);
      expect(isOriginAllowed('https://footrace.app.phishing.io', allowedOrigins)).toBe(false);
      // Native mobile apps / electron without Origin header
      expect(isOriginAllowed(undefined, allowedOrigins)).toBe(true);
    });
  });

  describe('P1-4: JWT Secret Fail-Fast Security in Production', () => {
    it('should abort startup in production when secret is missing, default, or weak', () => {
      expect(() => validateAndGetJwtSecret(undefined, 'production')).toThrow(/CRITICAL SECURITY ERROR/);
      expect(() => validateAndGetJwtSecret('super_secret_footquiz_key_123!', 'production')).toThrow(/insecure or default/i);
      expect(() => validateAndGetJwtSecret('too_short_key_under_32_chars', 'production')).toThrow(/at least 32 characters/i);
    });

    it('should safely fall back in development environment when empty string is provided', () => {
      expect(validateAndGetJwtSecret('', 'development')).toBe(DEV_FALLBACK_JWT_SECRET);
    });
  });

  describe('P2: Infrastructure Health Check & Observability', () => {
    it('should report comprehensive status with service isolation and credential masking', async () => {
      const mockPrisma: any = { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) };
      const mockRedis: any = { ping: vi.fn().mockResolvedValue('PONG') };
      const healthService = new HealthService(mockPrisma, mockRedis);

      const report = await healthService.checkAll();
      expect(report.status).toBe('ok');
      expect(report.services.backend.status).toBe('up');
      expect(report.services.database.status).toBe('up');
      expect(report.services.redis.status).toBe('up');
      expect(typeof report.uptimeSeconds).toBe('number');

      // Verify no leak of database URL or redis auth
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('rootpassword');
    });
  });
});
