/**
 * CORS Configuration for HTTP and WebSocket
 * Reads CORS_ORIGIN (comma-separated), provides local dev defaults,
 * and prevents wildcard origin with credentials in production.
 */
export function getCorsOrigins(): string[] {
  const envOrigins = process.env.CORS_ORIGIN;
  const isProd = process.env.NODE_ENV === 'production';

  if (envOrigins && envOrigins.trim().length > 0) {
    return envOrigins
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0 && o !== '*');
  }

  if (!isProd) {
    return [
      'http://localhost:3000',
      'http://localhost:4000',
      'http://localhost:4001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:4000',
      'http://127.0.0.1:4001',
    ];
  }

  // Güvenli üretim varsayılanı: Belirtilmemişse boş liste (CORS kapalı)
  return [];
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // Same-origin or non-browser / server-to-server requests
  return allowedOrigins.includes(origin);
}

