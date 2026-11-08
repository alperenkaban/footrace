/**
 * Centralized JWT configuration & fail-fast validation.
 * Ensures the application refuses to boot in production if JWT_SECRET
 * is missing, empty, too short (< 32 chars), or matches known default/insecure keys.
 */

export const INSECURE_DEFAULT_SECRETS: ReadonlySet<string> = new Set([
  'super_secret_footquiz_key_123!',
  'super_secret_jwt_key_for_dev_only',
  'super_secret',
  'secret',
  'changeme',
  'replace_with_a_secure_random_key_in_production',
]);

export const DEV_FALLBACK_JWT_SECRET = 'footrace-dev-only-jwt-secret-do-not-use-in-production';

export function validateAndGetJwtSecret(rawSecret?: string, nodeEnv?: string): string {
  const env = (nodeEnv ?? process.env.NODE_ENV ?? 'development').toLowerCase();
  const secret = (rawSecret !== undefined ? rawSecret : process.env.JWT_SECRET)?.trim();

  const isProduction = env === 'production';

  if (!secret) {
    if (isProduction) {
      throw new Error(
        'CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing in production environment. Application failed to start.'
      );
    }
    return DEV_FALLBACK_JWT_SECRET;
  }

  if (isProduction) {
    if (INSECURE_DEFAULT_SECRETS.has(secret)) {
      throw new Error(
        'CRITICAL SECURITY ERROR: Insecure or default JWT_SECRET detected in production environment. Application failed to start.'
      );
    }

    if (secret.length < 32) {
      throw new Error(
        'CRITICAL SECURITY ERROR: JWT_SECRET in production must be at least 32 characters long. Application failed to start.'
      );
    }
  }

  return secret;
}

