/**
 * Express application factory.
 *
 * Security controls applied here (in order):
 *  1. helmet — restrictive HTTP security headers + CSP
 *  2. cors — explicit allowlist, not wildcard
 *  3. cookieParser — populates req.cookies (required by csrf-csrf and session)
 *  4. compression — gzip response compression
 *  5. express.json with size limit — prevents large payload DoS
 *  6. Global rate limiter — baseline abuse protection
 *  7. Session management — server-side sessions in PostgreSQL
 *  8. CSRF token endpoint — GET /api/auth/csrf-token (before protection middleware)
 *  9. CSRF protection — double-submit cookie on all /api/* state-changing requests
 * 10. Routes — all business logic
 * 11. 404 handler — no route leakage
 * 12. Global error handler — strips stack traces and secrets from responses
 */

import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { sessionMiddleware } from './auth/session.js';
import { doubleCsrfProtection, generateCsrfToken } from './auth/csrf.js';
import type { ApiError, ApiSuccess } from '@store/shared';

export function createApp(): express.Application {
  const app = express();

  // -------------------------------------------------------------------------
  // Trust proxy — needed when behind nginx/load balancer for real IPs in limits
  // -------------------------------------------------------------------------
  if (config.env === 'production') {
    app.set('trust proxy', 1);
  }

  // -------------------------------------------------------------------------
  // Security headers via helmet
  // -------------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // relaxed for dev; tighten in prod
    }),
  );

  // -------------------------------------------------------------------------
  // CORS — explicit allowlist, not wildcard
  // -------------------------------------------------------------------------
  const allowedOrigins = config.corsOrigin.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow server-to-server requests (no Origin header) in development/test only
        if (!origin && config.env !== 'production') return callback(null, true);
        if (origin && allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
    }),
  );

  // -------------------------------------------------------------------------
  // Cookie parsing — MUST run before session and CSRF middleware.
  // The csrf-csrf library reads req.cookies directly; if this middleware is
  // absent, req.cookies is undefined and CSRF throws "Cannot use 'in' operator
  // to search for 'store.csrf' in undefined".
  // -------------------------------------------------------------------------
  app.use(cookieParser());

  // -------------------------------------------------------------------------
  // Compression
  // -------------------------------------------------------------------------
  app.use(compression());

  // -------------------------------------------------------------------------
  // Body parsing with size limits (prevents large payload attacks)
  // -------------------------------------------------------------------------
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // -------------------------------------------------------------------------
  // Global rate limit — additional per-route limits applied where needed
  // -------------------------------------------------------------------------
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 300,
      // Skip rate limiting in test environment so integration tests can run freely
      skip: () => config.env === 'test',
      standardHeaders: true,
      legacyHeaders: false,
      message: { ok: false, code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    }),
  );

  // -------------------------------------------------------------------------
  // Session management — server-side sessions stored in PostgreSQL
  // Cookie is HttpOnly, Secure in production, SameSite=Lax
  // -------------------------------------------------------------------------
  app.use(sessionMiddleware());

  // -------------------------------------------------------------------------
  // CSRF protection — double-submit cookie pattern via csrf-csrf library.
  //
  // The CSRF token endpoint must come BEFORE doubleCsrfProtection so that
  // the GET request to /api/auth/csrf-token is not blocked by CSRF checks.
  // State-changing requests (POST, PUT, PATCH, DELETE) to /api/* must include
  // the x-csrf-token header matching the value from the CSRF cookie.
  // -------------------------------------------------------------------------
  // CSRF token endpoint — must be before doubleCsrfProtection.
  // Returns a fresh CSRF token for the frontend to use on subsequent state-changing requests.
  app.get('/api/auth/csrf-token', (req: Request, res: Response) => {
    const token = generateCsrfToken(req, res);
    const body: ApiSuccess<{ token: string }> = { ok: true, data: { token } };
    res.status(200).json(body);
  });

  // Apply CSRF protection to all /api/* routes (state-changing methods only)
  app.use('/api', doubleCsrfProtection);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  app.use('/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', apiRouter);

  // -------------------------------------------------------------------------
  // 404 handler — returns JSON, never leaks route details
  // -------------------------------------------------------------------------
  app.use((_req: Request, res: Response) => {
    const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'The requested resource was not found.' };
    res.status(404).json(body);
  });

  // -------------------------------------------------------------------------
  // Global error handler — NEVER exposes stack traces or internal details
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Log the real error internally with sufficient detail for debugging
    const message = err instanceof Error ? err.message : String(err);
    console.error('[error]', message);

    // CSRF errors — return 403 with a clear, user-friendly message.
    // csrf-csrf generates errors via http-errors with code EBADCSRFTOKEN.
    // The error message from the library is "invalid csrf token" (lowercase).
    const isCsrfError =
      (err instanceof Error && (err as { code?: string }).code === 'EBADCSRFTOKEN') ||
      (err instanceof Error && err.message.toLowerCase().includes('invalid csrf token'));

    if (isCsrfError) {
      const body: ApiError = {
        ok: false,
        code: 'CSRF_ERROR',
        message: 'CSRF token validation failed. Please refresh the page and try again.',
      };
      return res.status(403).json(body);
    }

    if (config.env !== 'production') {
      // In dev, include the message to help developers; still no stack trace in body
      const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message };
      res.status(500).json(body);
    } else {
      // In production, return a generic message — never internal details
      const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
      res.status(500).json(body);
    }
  });

  return app;
}
