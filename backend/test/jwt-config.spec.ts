import { describe, it, expect } from 'vitest';
import {
  validateAndGetJwtSecret,
  DEV_FALLBACK_JWT_SECRET,
  INSECURE_DEFAULT_SECRETS,
} from '../src/auth/jwt.config.js';

describe('JWT Secret Configuration & Fail-Fast Suite', () => {
  const strongProdSecret = 'a_very_strong_and_secure_random_key_with_at_least_32_characters!';

  describe('Development Environment', () => {
    it('should return fallback dev secret when JWT_SECRET is missing in development', () => {
      const secret = validateAndGetJwtSecret(undefined, 'development');
      expect(secret).toBe(DEV_FALLBACK_JWT_SECRET);
    });

    it('should return custom secret when provided in development', () => {
      const customKey = 'my-local-dev-key';
      const secret = validateAndGetJwtSecret(customKey, 'development');
      expect(secret).toBe(customKey);
    });

    it('should trim whitespace around provided secret', () => {
      const secret = validateAndGetJwtSecret('  trimmed-key  ', 'development');
      expect(secret).toBe('trimmed-key');
    });
  });

  describe('Production Environment (Fail-Fast Verification)', () => {
    it('should throw fail-fast error when JWT_SECRET is missing or empty in production', () => {
      expect(() => validateAndGetJwtSecret(undefined, 'production')).toThrow(
        /CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing/i
      );
      expect(() => validateAndGetJwtSecret('', 'production')).toThrow(
        /CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing/i
      );
      expect(() => validateAndGetJwtSecret('   ', 'production')).toThrow(
        /CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing/i
      );
    });

    it('should throw fail-fast error for all known insecure default secrets in production', () => {
      for (const insecureKey of INSECURE_DEFAULT_SECRETS) {
        expect(() => validateAndGetJwtSecret(insecureKey, 'production')).toThrow(
          /CRITICAL SECURITY ERROR: Insecure or default JWT_SECRET detected/i
        );
      }
    });

    it('should throw fail-fast error when secret is too short in production (< 32 chars)', () => {
      const shortKey = 'short-secret-under-32-chars';
      expect(() => validateAndGetJwtSecret(shortKey, 'production')).toThrow(
        /CRITICAL SECURITY ERROR: JWT_SECRET in production must be at least 32 characters long/i
      );
    });

    it('should successfully return secret when a valid 32+ char key is used in production', () => {
      const secret = validateAndGetJwtSecret(strongProdSecret, 'production');
      expect(secret).toBe(strongProdSecret);
    });

    it('should never expose the secret value in the error message', () => {
      const dangerousKey = 'super_secret_footquiz_key_123!';
      try {
        validateAndGetJwtSecret(dangerousKey, 'production');
        expect.unreachable('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).not.toContain(dangerousKey);
      }
    });
  });
});

