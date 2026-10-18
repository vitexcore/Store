/**
 * Authorization middleware.
 *
 * Security model:
 *  1. requireAuth — checks that the user is authenticated via server-side session.
 *     Identity is derived from req.session.userId, NEVER from client-supplied data.
 *  2. loadUser — queries the database for the full user profile (including store_id)
 *     and attaches it to req.user. Must run after requireAuth.
 *  3. optionalLoadUser — like loadUser but for endpoints that work for both
 *     authenticated and unauthenticated users (e.g. GET /api/auth/me).
 *  4. requireStore — checks that the authenticated user is associated with a store.
 *  5. checkStoreOwnership — helper to verify resource belongs to user's store.
 *  6. denyResourceAccess — helper to send a consistent 403 response.
 *
 * Deny by default: unauthenticated requests receive 401, authenticated but
 * unauthorized requests receive 403.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ApiError, AuthUser } from '@store/shared';
import { query } from '../db/pool.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Extend Express types with auth context
// ---------------------------------------------------------------------------

declare module 'express-session' {
  interface Session {
    userId?: string;
  }
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

// ---------------------------------------------------------------------------
// requireAuth — fast session check, no DB call
// ---------------------------------------------------------------------------

/**
 * Require authentication: the user must have a valid server-side session.
 * Does NOT touch the database — just checks the session.
 */
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    const body: ApiError = {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'You must be logged in to access this resource.',
    };
    return res.status(401).json(body);
  }
  next();
};

// ---------------------------------------------------------------------------
// loadUser — full DB lookup, attaches req.user
// ---------------------------------------------------------------------------

/**
 * Load the authenticated user's profile (including store_id) from the database.
 * Must run after requireAuth. Attaches the safe AuthUser object to req.user.
 *
 * If the user no longer exists (e.g. was deleted), the session is cleared
 * and a 401 is returned.
 */
export const loadUser: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    const body: ApiError = {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'You must be logged in to access this resource.',
    };
    return res.status(401).json(body);
  }

  try {
    const result = await query<{
      id: string;
      email: string;
      role: string;
      store_id: string | null;
      store_name: string | null;
      store_slug: string | null;
      created_at: Date;
    }>(
      `SELECT u.id, u.email, u.role, u.store_id,
              s.name AS store_name, s.slug AS store_slug,
              u.created_at
       FROM users u
       LEFT JOIN stores s ON s.id = u.store_id
       WHERE u.id = $1`,
      [req.session.userId],
    );

    if (result.rows.length === 0) {
      // User no longer exists — destroy session and return 401
      req.session.destroy(() => {
        res.clearCookie(config.sessionCookieName);
        const body: ApiError = {
          ok: false,
          code: 'UNAUTHENTICATED',
          message: 'Your session is no longer valid.',
        };
        res.status(401).json(body);
      });
      return;
    }

    const row = result.rows[0]!;
    req.user = {
      id: row.id,
      email: row.email,
      role: row.role as AuthUser['role'],
      storeId: row.store_id,
      storeName: row.store_name,
      storeSlug: row.store_slug,
      createdAt: row.created_at.toISOString(),
    };

    next();
  } catch (err) {
    console.error('[auth] loadUser error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'An error occurred while verifying your session.',
    };
    res.status(500).json(body);
  }
};

// ---------------------------------------------------------------------------
// optionalLoadUser — for endpoints that work for both auth and unauth users
// ---------------------------------------------------------------------------

/**
 * Optional user loader — populates req.user if a valid session exists,
 * but always calls next(). Used by GET /api/auth/me so it can return
 * { user: null } for unauthenticated requests instead of 401.
 *
 * If the session exists but the user record is gone, the session is
 * silently cleared and next() is called with req.user === undefined.
 */
export const optionalLoadUser: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return next();
  }

  try {
    const result = await query<{
      id: string;
      email: string;
      role: string;
      store_id: string | null;
      store_name: string | null;
      store_slug: string | null;
      created_at: Date;
    }>(
      `SELECT u.id, u.email, u.role, u.store_id,
              s.name AS store_name, s.slug AS store_slug,
              u.created_at
       FROM users u
       LEFT JOIN stores s ON s.id = u.store_id
       WHERE u.id = $1`,
      [req.session.userId],
    );

    if (result.rows.length === 0) {
      // User deleted — silently clear the stale session and continue as unauthenticated
      req.session.destroy(() => {
        res.clearCookie(config.sessionCookieName);
      });
      return next();
    }

    const row = result.rows[0]!;
    req.user = {
      id: row.id,
      email: row.email,
      role: row.role as AuthUser['role'],
      storeId: row.store_id,
      storeName: row.store_name,
      storeSlug: row.store_slug,
      createdAt: row.created_at.toISOString(),
    };

    next();
  } catch (err) {
    console.error('[auth] optionalLoadUser error:', err instanceof Error ? err.message : String(err));
    // Don't fail the request — just proceed as unauthenticated
    next();
  }
};

// ---------------------------------------------------------------------------
// requireStore — ensures the authenticated user has a store
// ---------------------------------------------------------------------------

/**
 * Require that the authenticated user has a store associated.
 * Staff/admin without a store_id cannot access store-scoped endpoints.
 * Must run after loadUser.
 */
export const requireStore: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !req.user.storeId) {
    const body: ApiError = {
      ok: false,
      code: 'NO_STORE',
      message: 'You must be associated with a store to access this resource.',
    };
    return res.status(403).json(body);
  }
  next();
};

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the resource's store_id matches the authenticated user's
 * store_id. Use this in route handlers to prevent cross-store IDOR attacks.
 */
export function checkStoreOwnership(
  resourceStoreId: string | null | undefined,
  userStoreId: string | null | undefined,
): boolean {
  if (!userStoreId) return false;
  if (!resourceStoreId) return false;
  return resourceStoreId === userStoreId;
}

/**
 * Send a consistent 403 "forbidden" response.
 */
export function denyResourceAccess(res: Response): void {
  const body: ApiError = {
    ok: false,
    code: 'FORBIDDEN',
    message: 'You do not have access to this resource.',
  };
  res.status(403).json(body);
}
