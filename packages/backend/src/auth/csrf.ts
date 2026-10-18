/**
 * CSRF protection middleware using the double-submit cookie pattern (csrf-csrf).
 *
 * How it works:
 *  1. Frontend calls GET /api/auth/csrf-token — server sets a signed CSRF cookie
 *     and returns the token value in the response body.
 *  2. For state-changing requests (POST, PUT, PATCH, DELETE), the frontend sends
 *     the token in the x-csrf-token header. The server verifies it matches the
 *     CSRF cookie.
 *
 * Session identifier:
 *  We use the raw session cookie value (req.cookies[sessionCookieName]) as the
 *  session identifier for the CSRF HMAC. This is stable across the GET→POST
 *  flow regardless of whether saveUninitialized is true/false, because both
 *  requests send the same session cookie value. If no session cookie exists yet,
 *  'anonymous' is used — the CSRF cookie itself is then the only secret,
 *  which is the correct double-submit pattern.
 *
 * Security notes:
 *  - The CSRF cookie is NOT HttpOnly so the frontend JavaScript can read it.
 *  - The session cookie IS HttpOnly and contains only the opaque session ID.
 *  - An attacker on another origin cannot read either cookie (SameSite=Lax +
 *    CORS restricts cross-origin cookie access).
 *  - GET/HEAD/OPTIONS are excluded — they must be safe and idempotent.
 */

import { doubleCsrf } from 'csrf-csrf';
import { config } from '../config.js';

export const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => config.sessionSecret,
  // Use the raw session cookie value (stable across requests) rather than
  // req.sessionID (which changes if the session hasn't been saved yet).
  getSessionIdentifier: (req) =>
    (req.cookies as Record<string, string>)[config.sessionCookieName] ?? 'anonymous',
  cookieName: 'store.csrf',
  cookieOptions: {
    httpOnly: false, // Must be readable by JavaScript to include in x-csrf-token header
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/',
  },
  // Only protect state-changing methods
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  size: 64,
});
