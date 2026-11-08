import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCorsOrigins, isOriginAllowed } from '../src/common/cors.config.js';

describe('CORS Configuration & Security', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should parse comma-separated origins from CORS_ORIGIN', () => {
    process.env.CORS_ORIGIN = 'https://footrace.app, https://admin.footrace.app ';
    const origins = getCorsOrigins();
    expect(origins).toEqual(['https://footrace.app', 'https://admin.footrace.app']);
  });

  it('should filter out wildcard * from CORS_ORIGIN to protect credentials', () => {
    process.env.CORS_ORIGIN = 'https://footrace.app, *';
    const origins = getCorsOrigins();
    expect(origins).toEqual(['https://footrace.app']);
  });

  it('should provide standard local development origins when CORS_ORIGIN is not set in dev', () => {
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'development';
    const origins = getCorsOrigins();
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:4001');
  });

  it('should return empty list in production when CORS_ORIGIN is unset (safe fail-closed)', () => {
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'production';
    const origins = getCorsOrigins();
    expect(origins).toEqual([]);
  });

  it('should correctly allow trusted origins and reject untrusted origins', () => {
    const allowed = ['https://footrace.app', 'http://localhost:3000'];
    expect(isOriginAllowed('https://footrace.app', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true);
    expect(isOriginAllowed('https://malicious-site.com', allowed)).toBe(false);
    expect(isOriginAllowed(undefined, allowed)).toBe(true); // non-browser
  });
});

