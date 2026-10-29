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

  // Calendar timezone used for analytics date boundaries and daily grouping.
  // All analytics requests are interpreted in this single timezone, never the
  // browser's local timezone or an implicit server timezone.
  analyticsTimeZone: optional('ANALYTICS_TIMEZONE', 'Africa/Lagos'),

  // Paystack — test mode only. Use sk_test_... key.
  // Keep secret key server-side; never expose to frontend or logs.
  paystackSecretKey: process.env['PAYSTACK_SECRET_KEY'] ?? null,

  // Callback URL for Paystack redirect after payment (must be a trusted, configured URL).
  // The callback does NOT mark payment as successful — webhook verification does.
  paystackCallbackUrl: optional('PAYSTACK_CALLBACK_URL', 'http://localhost:3001/api/checkout/paystack/callback'),

  // AI assistant — OpenRouter (OpenAI-compatible API).
  // Key prefix: sk-or-v1-... Keep server-side, never expose in responses or logs.
  // Without this key the assistant returns a graceful unavailable response.
  aiApiKey: process.env['AI_API_KEY'] ?? null,
  // Model slug for OpenRouter. See https://openrouter.ai/models
  aiModel: optional('AI_MODEL', 'google/gemini-3.8-flash'),
  // Max tokens per response (controls cost and latency)
  aiMaxTokens: optionalInt('AI_MAX_TOKENS', 1024),
} as const;

// Validate the analytics timezone early so a typo fails at startup, not on a request.
try {
  new Intl.DateTimeFormat('en-US', { timeZone: config.analyticsTimeZone });
} catch {
  throw new Error(`ANALYTICS_TIMEZONE is not a valid IANA timezone: ${config.analyticsTimeZone}`);
}

// Validate session secret length in production AND test — dev allows placeholder for convenience
if (config.env !== 'development' && config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}
