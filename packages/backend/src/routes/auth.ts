import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { loadUser, optionalLoadUser } from '../auth/middleware.js';
import { config } from '../config.js';
import type { ApiSuccess, ApiError, AuthUser, AuthSession, AuthMeResponse } from '@store/shared';
import { isValidEmail, isNonEmptyString } from '@store/shared';

export const authRouter = Router();


// Rate limits for auth endpoints — stricter than global limit


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 auth attempts per 15 min per IP
  // Skip rate limiting in test environment so integration tests can run many requests
  skip: () => config.env === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Too many authentication attempts. Please try again later.',
  },
});


// Validation helpers

const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const STORE_NAME_MIN = 1;
const STORE_NAME_MAX = 120;
const STORE_SLUG_MAX = 80;

/**
 * Generate a URL-safe slug from a store name.
 * Falls back to a random suffix if the slug collides.
 */
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, STORE_SLUG_MAX - 8);
  return base || 'store';
}

/**
 * Regenerate the session to prevent session fixation attacks.
 * The old session is destroyed and a new session ID is issued.
 * The userId is carried over to the new session.
 */
function regenerateSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        resolve();
      });
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

authRouter.post(
  '/register',
  authLimiter,
  async (req: Request, res: Response) => {
    try {
      const { email, password, storeName } = req.body as {
        email?: unknown;
        password?: unknown;
        storeName?: unknown;
      };

      // --- Validate input ---
      const errors: string[] = [];

      if (!isValidEmail(email)) {
        errors.push('A valid email address is required.');
      } else if ((email as string).length > EMAIL_MAX) {
        errors.push(`Email must be at most ${EMAIL_MAX} characters.`);
      }

      if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
        errors.push(`Password must be at least ${PASSWORD_MIN} characters.`);
      } else if (password.length > PASSWORD_MAX) {
        errors.push(`Password must be at most ${PASSWORD_MAX} characters.`);
      }

      if (!isNonEmptyString(storeName, STORE_NAME_MAX)) {
        errors.push(`Store name must be between ${STORE_NAME_MIN} and ${STORE_NAME_MAX} characters.`);
      }

      if (errors.length > 0) {
        const body: ApiError = {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: errors.join(' '),
        };
        return res.status(400).json(body);
      }

      const normalizedEmail = (email as string).trim().toLowerCase();
      const storeNameTrimmed = (storeName as string).trim();
      const slug = generateSlug(storeNameTrimmed);

      // --- Check for existing email ---
      const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (existing.rows.length > 0) {
        // Generic message to avoid revealing which field caused the conflict
        const body: ApiError = {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Could not create account. Please check your details and try again.',
        };
        return res.status(409).json(body);
      }

      // --- Hash password ---
      const passwordHash = await hashPassword(password as string);

      // --- Create store + user in a transaction ---
      await query('BEGIN');
      try {
        // Create store with unique slug (add random suffix if needed)
        let finalSlug = slug;
        let suffix = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const slugCheck = await query('SELECT id FROM stores WHERE slug = $1', [finalSlug]);
          if (slugCheck.rows.length === 0) break;
          suffix++;
          finalSlug = `${slug}-${suffix}`.substring(0, STORE_SLUG_MAX);
        }

        const storeResult = await query<{ id: string; name: string; slug: string }>(
          'INSERT INTO stores (name, slug) VALUES ($1, $2) RETURNING id, name, slug',
          [storeNameTrimmed, finalSlug],
        );

        const store = storeResult.rows[0]!;

        const userResult = await query<{
          id: string;
          email: string;
          role: string;
          store_id: string;
          created_at: Date;
        }>(
          `INSERT INTO users (email, password_hash, role, store_id)
           VALUES ($1, $2, 'merchant', $3)
           RETURNING id, email, role, store_id, created_at`,
          [normalizedEmail, passwordHash, store.id],
        );

        const user = userResult.rows[0]!;

        await query('COMMIT');

        // --- Regenerate session to prevent session fixation ---
        await regenerateSession(req, user.id);

        const authUser: AuthUser = {
          id: user.id,
          email: user.email,
          role: user.role as AuthUser['role'],
          storeId: user.store_id,
          storeName: store.name,
          storeSlug: store.slug,
          createdAt: user.created_at.toISOString(),
        };

        const body: ApiSuccess<AuthSession> = {
          ok: true,
          data: { user: authUser },
        };
        return res.status(201).json(body);
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    } catch (err) {
      console.error('[auth] register error:', err instanceof Error ? err.message : String(err));
      const body: ApiError = {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during registration.',
      };
      return res.status(500).json(body);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

authRouter.post(
  '/login',
  authLimiter,
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email?: unknown; password?: unknown };

      // --- Validate input ---
      if (!isValidEmail(email) || typeof password !== 'string' || password.length === 0) {
        // Generic error — never reveal whether email exists
        const body: ApiError = {
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        };
        return res.status(401).json(body);
      }

      const normalizedEmail = (email as string).trim().toLowerCase();

      // --- Look up user ---
      const result = await query<{
        id: string;
        email: string;
        password_hash: string;
        role: string;
        store_id: string | null;
        store_name: string | null;
        store_slug: string | null;
        created_at: Date;
      }>(
        `SELECT u.id, u.email, u.password_hash, u.role, u.store_id,
                s.name AS store_name, s.slug AS store_slug,
                u.created_at
         FROM users u
         LEFT JOIN stores s ON s.id = u.store_id
         WHERE u.email = $1`,
        [normalizedEmail],
      );

      // --- Generic error for both "no user" and "wrong password" ---
      if (result.rows.length === 0) {
        const body: ApiError = {
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        };
        return res.status(401).json(body);
      }

      const user = result.rows[0]!;

      // --- Verify password ---
      const valid = await verifyPassword(user.password_hash, password as string);
      if (!valid) {
        const body: ApiError = {
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        };
        return res.status(401).json(body);
      }

      // --- Regenerate session to prevent session fixation ---
      await regenerateSession(req, user.id);

      const authUser: AuthUser = {
        id: user.id,
        email: user.email,
        role: user.role as AuthUser['role'],
        storeId: user.store_id,
        storeName: user.store_name,
        storeSlug: user.store_slug,
        createdAt: user.created_at.toISOString(),
      };

      const body: ApiSuccess<AuthSession> = {
        ok: true,
        data: { user: authUser },
      };
      return res.status(200).json(body);
    } catch (err) {
      console.error('[auth] login error:', err instanceof Error ? err.message : String(err));
      const body: ApiError = {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during login.',
      };
      return res.status(500).json(body);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

authRouter.post('/logout', (req: Request, res: Response) => {
  // Destroy the server-side session entirely — not just clear the cookie.
  // This means the session ID is no longer valid even if the cookie persists.
  req.session.destroy((err) => {
    if (err) {
      console.error('[auth] logout error:', err instanceof Error ? err.message : String(err));
      const body: ApiError = {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during logout.',
      };
      return res.status(500).json(body);
    }

    // Clear the session cookie on the client
    res.clearCookie(config.sessionCookieName, { path: '/' });

    const body: ApiSuccess<null> = { ok: true, data: null };
    res.status(200).json(body);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

authRouter.get('/me', optionalLoadUser, (req: Request, res: Response) => {
  const body: ApiSuccess<AuthMeResponse> = {
    ok: true,
    data: { user: req.user ?? null },
  };
  res.status(200).json(body);
});
