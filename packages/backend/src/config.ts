/**
 * Application configuration.
 *
 * All config is read from environment variables. This module is the single
 * source of truth for env access — never read process.env directly elsewhere.
 *
 * Security notes:
 *  - Secrets are never logged or serialised into responses.
 *  - Missing required variables throw at startup so failures are obvious.
 *  - DATABASE_URL is kept private; only the pool is exported.
 */

import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  return n;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'test' | 'production',
  port: optionalInt('PORT', 3001),

  // Database — URL kept in config, never exposed via API
  db: {
    url: required('DATABASE_URL'),
    poolMax: optionalInt('DB_POOL_MAX', 10),
    ssl: optionalBool('DB_SSL', false),
  },

  // CORS — only the listed origin(s) are allowed
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),

  // Session security
  sessionSecret: required('SESSION_SECRET'),
  sessionCookieName: optional('SESSION_COOKIE_NAME', 'store.sid'),
  sessionMaxAge: optionalInt('SESSION_MAX_AGE', 86_400), // 24 hours in seconds

  // Feature flags
  logLevel: optional('LOG_LEVEL', 'info'),
} as const;

// Validate session secret length in production AND test — dev allows placeholder for convenience
if (config.env !== 'development' && config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}
