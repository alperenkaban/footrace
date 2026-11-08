import { describe, it, expect } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { GuestLoginDto } from '../src/auth/dto/guest-login.dto.js';
import { BuyPackageDto } from '../src/shop/dto/shop.dto.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('Global ValidationPipe & DTO Security', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  describe('GuestLoginDto', () => {
    it('should accept valid displayName', async () => {
      const dto = plainToInstance(GuestLoginDto, { displayName: 'Ahmet123' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept empty / undefined displayName (guest fallback)', async () => {
      const dto = plainToInstance(GuestLoginDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject non-string displayName', async () => {
      const dto = plainToInstance(GuestLoginDto, { displayName: 12345 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.isString).toBeDefined();
    });

    it('should reject overly long displayName (>30 chars)', async () => {
      const dto = plainToInstance(GuestLoginDto, {
        displayName: 'A'.repeat(31),
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.maxLength).toBeDefined();
    });

    it('should reject unexpected unknown fields via ValidationPipe (forbidNonWhitelisted)', async () => {
      await expect(
        pipe.transform(
          { displayName: 'TestUser', maliciousAdminField: true },
          { type: 'body', metatype: GuestLoginDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('BuyPackageDto', () => {
    it('should require packageId and reject empty body', async () => {
      const dto = plainToInstance(BuyPackageDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('packageId');
    });

    it('should reject unknown injection parameters', async () => {
      await expect(
        pipe.transform(
          { packageId: 'coins_100', hackedPrice: 0 },
          { type: 'body', metatype: BuyPackageDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

