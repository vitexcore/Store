/**
 * Session management middleware using express-session with a PostgreSQL
 * session store (connect-pg-simple).
 *
 * Security notes:
 *  - Session data is stored server-side in PostgreSQL; the cookie contains
 *    only an opaque session ID, never the session payload.
 *  - Cookie is HttpOnly (not accessible to JavaScript).
 *  - Cookie is Secure in production (HTTPS only).
 *  - SameSite=Lax prevents CSRF for top-level navigations while allowing
 *    legitimate cross-site links. State-changing endpoints require the
 *    CSRF token header in addition to the session cookie.
 *  - Session expiration is enforced both by the cookie maxAge and the
 *    server-side session store (connect-pg-simple prunes expired rows).
 */

import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';

const PostgresStore = connectPgSimple(session);

let _store: InstanceType<typeof PostgresStore> | null = null;

function getSessionStore() {
  if (!_store) {
    _store = new PostgresStore({
      pool: getPool(),
      tableName: 'session',
      // Prune expired sessions every 15 minutes
      pruneSessionInterval: 15 * 60,
    });
  }
  return _store;
}

export function sessionMiddleware(): RequestHandler {
  return session({
    name: config.sessionCookieName,
    store: getSessionStore(),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiration on each request
    cookie: {
      httpOnly: true,
      secure: config.env === 'production', // Secure in production (HTTPS)
      sameSite: 'lax',
      maxAge: config.sessionMaxAge * 1000, // Convert seconds to milliseconds
      path: '/',
    },
  }) as unknown as RequestHandler;
}
