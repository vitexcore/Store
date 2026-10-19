/**
 * Authentication and authorization integration tests.
 *
 * Tests cover:
 *  - Registration (success, duplicate email, validation errors)
 *  - Login (success, invalid credentials, missing fields)
 *  - Logout (invalidates session)
 *  - /me endpoint (returns user when authenticated, null when not)
 *  - Password hashing (passwords are stored as Argon2id hashes, not plaintext)
 *  - Auth required on protected routes
 *  - Store ownership / data isolation (cross-store access denied)
 *
 * Uses supertest with cookie persistence to simulate real session behavior.
 */

import request from 'supertest';
import { createApp } from '../app.js';
import { closePool, query } from '../db/pool.js';
import type { Express } from 'express';

const app: Express = createApp();

// Helper: generate unique email for each test run to avoid conflicts
function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

// Helper: extract cookies from response
function extractCookies(res: request.Response): string {
  const setCookies = res.headers['set-cookie'];
  if (!setCookies) return '';
  return setCookies.map((c: string) => c.split(';')[0]).join('; ');
}

/**
 * Merge new cookies from a response into an existing cookie string.
 * New cookies override existing ones with the same name.
 */
function mergeCookies(existing: string, newCookies: string): string {
  const existingMap = new Map<string, string>();
  if (existing) {
    existing.split('; ').forEach((c) => {
      const eqIdx = c.indexOf('=');
      if (eqIdx > 0) existingMap.set(c.substring(0, eqIdx), c);
    });
  }
  if (newCookies) {
    newCookies.split('; ').forEach((c) => {
      const eqIdx = c.indexOf('=');
      if (eqIdx > 0) existingMap.set(c.substring(0, eqIdx), c);
    });
  }
  return Array.from(existingMap.values()).join('; ');
}

// Helper: get CSRF token, merging response cookies with any existing cookies
async function getCsrfToken(cookies: string): Promise<{ csrfToken: string; cookies: string }> {
  const res = await request(app)
    .get('/api/auth/csrf-token')
    .set('Cookie', cookies);
  const token = res.body.data?.token ?? '';
  const responseCookies = extractCookies(res);
  // Merge: new CSRF cookie overwrites old, but session cookie is preserved
  const mergedCookies = mergeCookies(cookies, responseCookies);
  return { csrfToken: token, cookies: mergedCookies };
}

// Helper: register a new user and return cookies + CSRF token
async function registerUser(
  email: string,
  password = 'TestPass123!',
  storeName = 'Test Store',
): Promise<{ cookies: string; csrfToken: string; user: { id: string; storeId: string } }> {
  // Get CSRF token (anonymous session)
  const { csrfToken: token1, cookies: cookies1 } = await getCsrfToken('');
  // Register (session is regenerated — response contains new session cookie)
  const res = await request(app)
    .post('/api/auth/register')
    .set('Cookie', cookies1)
    .set('x-csrf-token', token1)
    .send({ email, password, storeName });
  // Merge new session cookie from register response with existing cookies
  const sessionCookies = mergeCookies(cookies1, extractCookies(res));
  // Get a fresh CSRF token bound to the new session
  const { csrfToken, cookies: finalCookies } = await getCsrfToken(sessionCookies);
  return {
    cookies: finalCookies,
    csrfToken,
    user: { id: res.body.data?.user?.id ?? '', storeId: res.body.data?.user?.storeId ?? '' },
  };
}

// Helper: login and return cookies + CSRF token
async function loginUser(
  email: string,
  password = 'TestPass123!',
): Promise<{ cookies: string; csrfToken: string }> {
  const { csrfToken: token1, cookies: cookies1 } = await getCsrfToken('');
  const res = await request(app)
    .post('/api/auth/login')
    .set('Cookie', cookies1)
    .set('x-csrf-token', token1)
    .send({ email, password });
  const sessionCookies = mergeCookies(cookies1, extractCookies(res));
  const { csrfToken, cookies: finalCookies } = await getCsrfToken(sessionCookies);
  return { cookies: finalCookies, csrfToken };
}

// Helper: make an authenticated request with CSRF token
function authedRequest(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  cookies: string,
  csrfToken: string,
  body?: unknown,
): request.Test {
  const req = (request(app) as unknown as Record<string, (path: string) => request.Test>)[method](path)
    .set('Cookie', cookies)
    .set('x-csrf-token', csrfToken);
  if (body) req.send(body);
  return req;
}

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  it('successfully registers a new merchant with a store', async () => {
    const email = uniqueEmail();
    const { csrfToken, cookies } = await getCsrfToken('');

    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email, password: 'TestPass123!', storeName: 'My Test Store' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.role).toBe('merchant');
    expect(res.body.data.user.storeId).toBeTruthy();
    expect(res.body.data.user.storeName).toBe('My Test Store');
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects duplicate email with a generic error', async () => {
    const email = uniqueEmail();
    // First registration
    await registerUser(email);
    // Second registration with same email
    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email, password: 'AnotherPass123!', storeName: 'Another Store' });

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    // Generic message — should NOT say "email already exists"
    expect(res.body.message).not.toMatch(/already exists|duplicate|in use/i);
  });

  it('rejects invalid email', async () => {
    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email: 'not-an-email', password: 'TestPass123!', storeName: 'Test Store' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects short password', async () => {
    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email: uniqueEmail(), password: 'short', storeName: 'Test Store' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects missing store name', async () => {
    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email: uniqueEmail(), password: 'TestPass123!', storeName: '' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('successfully logs in with valid credentials', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email, password: 'TestPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects wrong password with a generic error', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email, password: 'WrongPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    // Generic error — should NOT reveal which field is wrong
    expect(res.body.message).toBe('Invalid email or password.');
  });

  it('rejects non-existent email with the same generic error', async () => {
    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email: 'nonexistent@example.com', password: 'TestPass123!' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe('Invalid email or password.');
  });

  it('rejects missing fields', async () => {
    const { csrfToken, cookies } = await getCsrfToken('');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ email: '', password: '' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  it('successfully logs out and invalidates the session', async () => {
    const email = uniqueEmail();
    const { cookies, csrfToken } = await registerUser(email);

    // Verify we're authenticated
    const meRes1 = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(meRes1.body.data.user).toBeTruthy();

    // Log out
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // Extract the new cookies (session cookie should be cleared)
    const logoutCookies = extractCookies(logoutRes);

    // Verify session is invalidated — /me should return null user
    const meRes2 = await request(app).get('/api/auth/me').set('Cookie', logoutCookies);
    expect(meRes2.body.ok).toBe(true);
    expect(meRes2.body.data.user).toBeNull();
  });

  it('rejects logout without CSRF token', async () => {
    const email = uniqueEmail();
    const { cookies } = await registerUser(email);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookies);
    // CSRF protection should reject this
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  it('returns the authenticated user when logged in', async () => {
    const email = uniqueEmail();
    const { cookies } = await registerUser(email);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user).toBeTruthy();
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.password_hash).toBeUndefined();
  });

  it('returns null user when not logged in', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

describe('Password hashing', () => {
  it('stores Argon2id hashes, not plaintext passwords', async () => {
    const email = uniqueEmail();
    const password = 'MySecurePassword123!';
    await registerUser(email, password);

    // Query the database directly to verify the hash
    const result = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      [email],
    );

    expect(result.rows.length).toBe(1);
    const hash = result.rows[0]!.password_hash;
    // Argon2id hashes start with $argon2id$
    expect(hash).toMatch(/^\$argon2id\$/);
    // Must NOT be the plaintext password
    expect(hash).not.toBe(password);
    expect(hash).not.toContain(password);
  });
});

// ---------------------------------------------------------------------------
// Auth required on protected routes
// ---------------------------------------------------------------------------

describe('Protected route enforcement', () => {
  it('rejects unauthenticated GET /api/dashboard', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects unauthenticated GET /api/products', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('rejects unauthenticated GET /api/orders', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('rejects unauthenticated GET /api/transactions', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('rejects unauthenticated POST /api/products', async () => {
    const res = await request(app).post('/api/products').send({ name: 'Test' });
    // Without a CSRF token, CSRF protection triggers first (403).
    // With a valid CSRF token but no session, auth triggers (401).
    // Both are correct rejection behaviors for unauthenticated state-changing requests.
    expect([401, 403]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });

  it('allows authenticated GET /api/dashboard', async () => {
    const { cookies } = await registerUser(uniqueEmail());
    const res = await request(app).get('/api/dashboard').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Store ownership / data isolation
// ---------------------------------------------------------------------------

describe('Store ownership and data isolation', () => {
  it('allows a merchant to access their own products', async () => {
    const { cookies, csrfToken } = await registerUser(uniqueEmail());

    // Create a product
    const createRes = await authedRequest('post', '/api/products', cookies, csrfToken, {
      name: 'Test Product',
      price_cents: 1000,
      currency: 'GBP',
      status: 'active',
    });
    expect(createRes.status).toBe(201);
    const productId = createRes.body.data.id;

    // Fetch the product
    const getRes = await authedRequest('get', `/api/products/${productId}`, cookies, csrfToken);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('Test Product');
  });

  it('prevents a merchant from accessing another merchant\'s product', async () => {
    // Merchant A creates a product
    const merchantA = await registerUser(uniqueEmail());
    const createRes = await authedRequest('post', '/api/products', merchantA.cookies, merchantA.csrfToken, {
      name: 'Merchant A Product',
      price_cents: 2000,
      currency: 'GBP',
      status: 'active',
    });
    expect(createRes.status).toBe(201);
    const productId = createRes.body.data.id;

    // Merchant B tries to access it
    const merchantB = await registerUser(uniqueEmail());
    const getRes = await authedRequest('get', `/api/products/${productId}`, merchantB.cookies, merchantB.csrfToken);
    expect(getRes.status).toBe(403);
    expect(getRes.body.code).toBe('FORBIDDEN');
  });

  it('prevents a merchant from updating another merchant\'s product', async () => {
    const merchantA = await registerUser(uniqueEmail());
    const createRes = await authedRequest('post', '/api/products', merchantA.cookies, merchantA.csrfToken, {
      name: 'Original Product',
      price_cents: 1500,
      currency: 'GBP',
      status: 'active',
    });
    const productId = createRes.body.data.id;

    const merchantB = await registerUser(uniqueEmail());
    const updateRes = await authedRequest('put', `/api/products/${productId}`, merchantB.cookies, merchantB.csrfToken, {
      name: 'Hijacked Product',
    });
    expect(updateRes.status).toBe(403);
  });

  it('prevents a merchant from deleting another merchant\'s product', async () => {
    const merchantA = await registerUser(uniqueEmail());
    const createRes = await authedRequest('post', '/api/products', merchantA.cookies, merchantA.csrfToken, {
      name: 'Protected Product',
      price_cents: 3000,
      currency: 'GBP',
      status: 'active',
    });
    const productId = createRes.body.data.id;

    const merchantB = await registerUser(uniqueEmail());
    const deleteRes = await authedRequest('delete', `/api/products/${productId}`, merchantB.cookies, merchantB.csrfToken);
    expect(deleteRes.status).toBe(403);
  });

  it('prevents a merchant from accessing another merchant\'s orders', async () => {
    const merchantA = await registerUser(uniqueEmail());
    const createRes = await authedRequest('post', '/api/orders', merchantA.cookies, merchantA.csrfToken, {
      reference: `ORD-ISO-${Date.now()}-A`,
      total_cents: 5000,
      currency: 'GBP',
    });
    const orderId = createRes.body.data.id;

    const merchantB = await registerUser(uniqueEmail());
    const getRes = await authedRequest('get', `/api/orders/${orderId}`, merchantB.cookies, merchantB.csrfToken);
    expect(getRes.status).toBe(403);
  });

  it('prevents a merchant from updating another merchant\'s order status', async () => {
    const merchantA = await registerUser(uniqueEmail());
    const createRes = await authedRequest('post', '/api/orders', merchantA.cookies, merchantA.csrfToken, {
      reference: `ORD-ISO-${Date.now()}-B`,
      total_cents: 3000,
      currency: 'GBP',
    });
    const orderId = createRes.body.data.id;

    const merchantB = await registerUser(uniqueEmail());
    const updateRes = await authedRequest('patch', `/api/orders/${orderId}/status`, merchantB.cookies, merchantB.csrfToken, {
      status: 'confirmed',
    });
    expect(updateRes.status).toBe(403);
  });

  it('prevents a merchant from accessing another merchant\'s transactions', async () => {
    const merchantA = await registerUser(uniqueEmail());
    const orderRes = await authedRequest('post', '/api/orders', merchantA.cookies, merchantA.csrfToken, {
      reference: `ORD-TXN-${Date.now()}`,
      total_cents: 2500,
      currency: 'GBP',
    });
    const orderId = orderRes.body.data.id;
    const storeId = orderRes.body.data.store_id;

    // Insert a transaction directly (no checkout endpoint yet)
    const paymentToken = `tok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await query(
      `INSERT INTO transactions (store_id, order_id, payment_token, status, amount_cents, currency)
       VALUES ($1, $2, $3, 'pending', 2500, 'GBP')`,
      [storeId, orderId, paymentToken],
    );

    const txnRes = await query('SELECT id FROM transactions WHERE store_id = $1', [storeId]);
    const txnId = txnRes.rows[0]!.id;

    // Merchant B tries to access it
    const merchantB = await registerUser(uniqueEmail());
    const getRes = await authedRequest('get', `/api/transactions/${txnId}`, merchantB.cookies, merchantB.csrfToken);
    expect(getRes.status).toBe(403);
  }, 15000); // Extended timeout — this test does multiple DB operations

  it('only lists products belonging to the authenticated merchant\'s store', async () => {
    const merchantA = await registerUser(uniqueEmail());
    const suffix = Date.now();
    await authedRequest('post', '/api/products', merchantA.cookies, merchantA.csrfToken, {
      name: `Product-A1-${suffix}`,
      price_cents: 1000,
      currency: 'GBP',
      status: 'active',
    });
    await authedRequest('post', '/api/products', merchantA.cookies, merchantA.csrfToken, {
      name: `Product-A2-${suffix}`,
      price_cents: 2000,
      currency: 'GBP',
      status: 'draft',
    });

    const merchantB = await registerUser(uniqueEmail());
    await authedRequest('post', '/api/products', merchantB.cookies, merchantB.csrfToken, {
      name: `Product-B1-${suffix}`,
      price_cents: 3000,
      currency: 'GBP',
      status: 'active',
    });

    // Merchant A should see only their 2 products
    const listA = await authedRequest('get', '/api/products', merchantA.cookies, merchantA.csrfToken);
    expect(listA.status).toBe(200);
    expect(listA.body.data.items.length).toBe(2);
    expect(listA.body.data.items.every((p: { name: string }) => p.name.startsWith(`Product-A`))).toBe(true);

    // Merchant B should see only their 1 product
    const listB = await authedRequest('get', '/api/products', merchantB.cookies, merchantB.csrfToken);
    expect(listB.status).toBe(200);
    expect(listB.body.data.items.length).toBe(1);
    expect(listB.body.data.items[0].name).toBe(`Product-B1-${suffix}`);
  });
});

// ---------------------------------------------------------------------------
// CSRF protection
// ---------------------------------------------------------------------------

describe('CSRF protection', () => {
  it('provides a CSRF token via GET /api/auth/csrf-token', async () => {
    const res = await request(app).get('/api/auth/csrf-token');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(typeof res.body.data.token).toBe('string');
  });

  it('rejects POST without CSRF token', async () => {
    const { cookies } = await registerUser(uniqueEmail());
    const res = await request(app)
      .post('/api/products')
      .set('Cookie', cookies)
      .send({ name: 'Test', price_cents: 1000 });
    expect(res.status).toBe(403);
  });

  it('rejects POST with mismatched CSRF token', async () => {
    const { cookies } = await registerUser(uniqueEmail());
    const res = await request(app)
      .post('/api/products')
      .set('Cookie', cookies)
      .set('x-csrf-token', 'invalid-token')
      .send({ name: 'Test', price_cents: 1000 });
    expect(res.status).toBe(403);
  });
});
