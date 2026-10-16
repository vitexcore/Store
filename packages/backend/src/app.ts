/**
 * Express application factory.
 *
 * Security controls applied here (in order):
 *  1. helmet — restrictive HTTP security headers + CSP
 *  2. cors — allowlist CORS origin
 *  3. express.json with size limit — prevents large payload DoS
 *  4. Global rate limiter — baseline abuse protection
 *  5. Routes — all business logic
 *  6. 404 handler — no route leakage
 *  7. Error handler — strips stack traces and secrets from responses
 */

import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import type { ApiError } from '@store/shared';

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
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

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
      standardHeaders: true,
      legacyHeaders: false,
      message: { ok: false, code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    }),
  );

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  app.use('/health', healthRouter);
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
