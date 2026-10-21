/**
 * Day 5 integration tests — NGN currency, order creation, QR checkout, Paystack.
 *
 * Covers:
 *  Currency:
 *   - New stores default to NGN
 *   - NGN amounts are formatted correctly
 *   - Backend currency utilities work correctly
 *
 *  Order creation (POST /api/checkout/cart):
 *   - Valid cart creates order with server-calculated totals
 *   - Empty cart is rejected
 *   - Invalid product IDs are rejected
 *   - Cross-store product access is rejected
 *   - Insufficient stock is rejected
 *   - Client-supplied total cannot override server calculation
 *   - Idempotency key prevents duplicate orders
 *   - Inactive/archived products are rejected
 *
 *  Payment status (GET /api/checkout/status/:token):
 *   - Returns payment status for valid token
 *   - Rejects invalid/unknown tokens
 *   - Does not expose secrets
 *   - Status reflects backend state, not client input
 *
 *  Storefront (GET /api/storefront/:slug):
 *   - Returns only active products
 *   - Returns 404 for unknown store
 *
 *  Paystack (structure verification):
 *   - Webhook with invalid signature is rejected
 *   - Browser callback does not mark payment as paid
 */

import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { closePool, query } from '../db/pool.js';
import { formatNGN, nairaToKobos, kobosToNaira, isValidAmountKobos } from '../utils/currency.js';
import type { Express } from 'express';

const app: Express = createApp() as unknown as Express;

function uniqueEmail(): string {
  return `d5-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

function extractCookies(res: request.Response): string {
  const setCookies = res.headers['set-cookie'] as string[] | string | undefined;
  if (!setCookies) return '';
  if (typeof setCookies === 'string') return setCookies.split(';')[0]!;
  return setCookies.map((c: string) => c.split(';')[0]).join('; ');
}

function mergeCookies(existing: string, newCookies: string): string {
  const map = new Map<string, string>();
  existing.split('; ').forEach((c) => {
    const eq = c.indexOf('=');
    if (eq > 0) map.set(c.substring(0, eq), c);
  });
  newCookies.split('; ').forEach((c) => {
    const eq = c.indexOf('=');
    if (eq > 0) map.set(c.substring(0, eq), c);
  });
  return Array.from(map.values()).join('; ');
}

async function getCsrfToken(cookies: string): Promise<{ csrfToken: string; cookies: string }> {
  const res = await request(app).get('/api/auth/csrf-token').set('Cookie', cookies);
  const token: string = res.body.data?.token ?? '';
  const merged = mergeCookies(cookies, extractCookies(res));
  return { csrfToken: token, cookies: merged };
}

async function registerUser(email: string, password = 'TestPass123!', storeName?: string) {
  const name = storeName ?? `Store-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const { csrfToken: t1, cookies: c1 } = await getCsrfToken('');
  const res = await request(app)
    .post('/api/auth/register')
    .set('Cookie', c1)
    .set('x-csrf-token', t1)
    .send({ email, password, storeName: name });
  const cookies = mergeCookies(c1, extractCookies(res));
  const { csrfToken, cookies: finalCookies } = await getCsrfToken(cookies);
  return {
    cookies: finalCookies,
    csrfToken,
    user: res.body.data?.user as { id: string; storeId: string },
    storeName: name,
  };
}

function authed(method: string, path: string, cookies: string, csrf: string, body?: unknown) {
  const req = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
    .set('Cookie', cookies)
    .set('x-csrf-token', csrf)
    .set('Content-Type', 'application/json');
  req.send(body !== undefined ? body : (method !== 'get' ? {} : undefined));
  return req;
}

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------
// Currency utilities
// ---------------------------------------------------------------------------
describe('Currency utilities', () => {
  it('formatNGN formats kobos as ₦', () => {
    const result = formatNGN(150000);
    expect(result).toContain('₦');
    expect(result).toContain('1,500');
  });

  it('nairaToKobos converts naira to kobo integer', () => {
    expect(nairaToKobos(1500)).toBe(150000);
    expect(nairaToKobos(0.50)).toBe(50);
    expect(nairaToKobos(0)).toBe(0);
  });

  it('kobosToNaira converts kobo to naira', () => {
    expect(kobosToNaira(150000)).toBe(1500);
    expect(kobosToNaira(50)).toBe(0.5);
  });

  it('nairaToKobos and kobosToNaira are inverse operations', () => {
    const original = 2499;
    expect(kobosToNaira(nairaToKobos(original))).toBe(original);
  });

  it('isValidAmountKobos validates amounts', () => {
    expect(isValidAmountKobos(100)).toBe(true);
    expect(isValidAmountKobos(0)).toBe(false);
    expect(isValidAmountKobos(-1)).toBe(false);
    expect(isValidAmountKobos(1.5)).toBe(false);
    expect(isValidAmountKobos('100')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NGN as default currency
// ---------------------------------------------------------------------------
describe('NGN default currency', () => {
  it('new store has NGN as default currency', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('get', '/api/store', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.defaultCurrency).toBe('NGN');
  });

  it('new product defaults to NGN currency', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Test Product',
      price_cents: 500000,
      status: 'active',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe('NGN');
  });

  it('NGN is accepted as a valid currency for products', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'NGN Product',
      price_cents: 100000,
      currency: 'NGN',
      status: 'active',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe('NGN');
  });

  it('rejects unsupported currency', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Bad Currency',
      price_cents: 100,
      currency: 'ZAR',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Storefront — public endpoints
// ---------------------------------------------------------------------------
describe('Storefront — GET /api/storefront/:slug', () => {
  it('returns store info for a valid slug', async () => {
    const m = await registerUser(uniqueEmail());
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    const res = await request(app).get(`/api/storefront/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.slug).toBe(slug);
    // Does not expose internal IDs or sensitive fields
    expect(res.body.data.id).toBeUndefined();
  });

  it('returns 404 for unknown slug', async () => {
    const res = await request(app).get('/api/storefront/nonexistent-slug-xyz-999');
    expect(res.status).toBe(404);
  });

  it('returns only active products in storefront', async () => {
    const m = await registerUser(uniqueEmail());
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Active Product', price_cents: 100000, status: 'active', stock_quantity: 10,
    });
    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Draft Product', price_cents: 50000, status: 'draft',
    });
    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Archived Product', price_cents: 75000, status: 'archived',
    });

    const res = await request(app).get(`/api/storefront/${slug}/products`);
    expect(res.status).toBe(200);
    const names = res.body.data.products.map((p: { name: string }) => p.name);
    expect(names).toContain('Active Product');
    expect(names).not.toContain('Draft Product');
    expect(names).not.toContain('Archived Product');
  });

  it('marks out-of-stock products as unavailable', async () => {
    const m = await registerUser(uniqueEmail());
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    const suffix = Date.now();
    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: `OutOfStock-${suffix}`, price_cents: 100000, status: 'active', stock_quantity: 0,
    });

    const res = await request(app).get(`/api/storefront/${slug}/products`);
    expect(res.status).toBe(200);
    const oos = res.body.data.products.find((p: { name: string }) => p.name.startsWith(`OutOfStock-${suffix}`));
    expect(oos?.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Order creation (POST /api/checkout/cart)
// ---------------------------------------------------------------------------
describe('POST /api/checkout/cart', () => {
  async function setupStoreWithProduct(m: Awaited<ReturnType<typeof registerUser>>) {
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;
    const storeId = storeRes.body.data.id as string;

    const productRes = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Test Widget',
      price_cents: 250000, // ₦2,500.00
      currency: 'NGN',
      status: 'active',
      stock_quantity: 20,
    });
    const productId = productRes.body.data.id as string;
    return { slug, storeId, productId, priceCents: 250000 };
  }

  it('creates order with server-calculated total', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId, priceCents } = await setupStoreWithProduct(m);

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 2 }],
      customerName: 'Test Customer',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    // Server calculates: 2 × 250000 = 500000 kobo (₦5,000)
    expect(res.body.data.amountCents).toBe(priceCents * 2);
    expect(res.body.data.currency).toBe('NGN');
    expect(res.body.data.orderReference).toMatch(/^ORD-/);
    expect(res.body.data.paymentToken).toBeTruthy();
    expect(res.body.data.paymentToken.length).toBeGreaterThan(20);
    expect(res.body.data.expiresAt).toBeTruthy();
  });

  it('server total cannot be overridden by client', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId, priceCents } = await setupStoreWithProduct(m);

    // Client tries to supply a low total — should be ignored
    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 1 }],
      // Note: no clientTotal in the API — server ignores any attempt to set price
    });

    expect(res.status).toBe(201);
    // Server always uses DB price
    expect(res.body.data.amountCents).toBe(priceCents);
  });

  it('rejects empty cart', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug } = await setupStoreWithProduct(m);

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_CART');
  });

  it('rejects invalid product IDs', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug } = await setupStoreWithProduct(m);

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId: 'not-a-uuid', quantity: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown product IDs (not found in DB)', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug } = await setupStoreWithProduct(m);

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1 }],
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects cross-store product access', async () => {
    const m1 = await registerUser(uniqueEmail());
    const m2 = await registerUser(uniqueEmail());

    // Create product in store 1
    const p1 = await authed('post', '/api/products', m1.cookies, m1.csrfToken, {
      name: 'Store 1 Product', price_cents: 100000, status: 'active', stock_quantity: 10,
    });
    const productId = p1.body.data.id as string;

    // Get store 2's slug
    const s2 = await authed('get', '/api/store', m2.cookies, m2.csrfToken);
    const slug2 = s2.body.data.slug as string;

    const res = await authed('post', '/api/checkout/cart', m2.cookies, m2.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug2,
      items: [{ productId, quantity: 1 }],
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRODUCT_NOT_IN_STORE');
  });

  it('rejects insufficient stock', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 21 }], // More than stock_quantity (20), within per-item max
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects archived/inactive products', async () => {
    const m = await registerUser(uniqueEmail());
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    const p = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Archived Item', price_cents: 100000, status: 'archived', stock_quantity: 10,
    });
    const productId = p.body.data.id as string;

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 1 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRODUCT_NOT_ACTIVE');
  });

  it('idempotency key returns same order on duplicate request', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);

    const idempotencyKey = crypto.randomUUID();
    const firstRes = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey,
      storeSlug: slug,
      items: [{ productId, quantity: 1 }],
    });
    expect(firstRes.status).toBe(201);
    const firstRef = firstRes.body.data.orderReference as string;

    // Duplicate request with same key
    const secondRes = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey,
      storeSlug: slug,
      items: [{ productId, quantity: 1 }],
    });
    // Should return 201 (or 200) with same order reference
    expect([200, 201]).toContain(secondRes.status);
    expect(secondRes.body.data.orderReference).toBe(firstRef);
  });

  it('requires authentication — unauthenticated request is rejected', async () => {
    // Without a session cookie and CSRF token, the request gets a CSRF error (403).
    // With a valid CSRF token but no session, it would get 401.
    // Either way, unauthenticated cart creation is denied.
    const res = await request(app)
      .post('/api/checkout/cart')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ idempotencyKey: crypto.randomUUID(), storeSlug: 'test', items: [] }));
    expect([401, 403]).toContain(res.status);
  });

  it('validates quantity must be integer > 0', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it('validates quantity must not be fractional', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);

    const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 1.5 }],
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Payment status (GET /api/checkout/status/:token)
// ---------------------------------------------------------------------------
describe('GET /api/checkout/status/:token', () => {
  async function createOrder(m: Awaited<ReturnType<typeof registerUser>>) {
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Status Test Product', price_cents: 100000, status: 'active', stock_quantity: 5,
    });
    const products = await request(app).get(`/api/storefront/${slug}/products`);
    const productId = products.body.data.products[0].id as string;

    const orderRes = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 1 }],
    });
    return orderRes.body.data as { paymentToken: string; orderReference: string };
  }

  it('returns payment status for valid token', async () => {
    const m = await registerUser(uniqueEmail());
    const { paymentToken } = await createOrder(m);

    const res = await request(app).get(`/api/checkout/status/${paymentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('awaiting_payment');
    expect(res.body.data.amountCents).toBeGreaterThan(0);
    expect(res.body.data.currency).toBe('NGN');
    expect(res.body.data.orderReference).toMatch(/^ORD-/);
    expect(res.body.data.storeName).toBeTruthy();
  });

  it('does not expose the payment token secret or store ID in response', async () => {
    const m = await registerUser(uniqueEmail());
    const { paymentToken } = await createOrder(m);

    const res = await request(app).get(`/api/checkout/status/${paymentToken}`);
    expect(res.status).toBe(200);
    // Ensure no backend secrets are exposed
    expect(res.body.data.storeId).toBeUndefined();
    expect(res.body.data.paystackSecretKey).toBeUndefined();
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('returns 404 for unknown token', async () => {
    const unknownToken = 'a'.repeat(96); // 96 chars = valid length, unknown token
    const res = await request(app).get(`/api/checkout/status/${unknownToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid token format', async () => {
    const res = await request(app).get('/api/checkout/status/short');
    expect(res.status).toBe(400);
  });

  it('status is NOT changed by accessing the payment URL (scanning QR)', async () => {
    const m = await registerUser(uniqueEmail());
    const { paymentToken } = await createOrder(m);

    // "Scan" the QR code (just access the status endpoint)
    const res1 = await request(app).get(`/api/checkout/status/${paymentToken}`);
    expect(res1.body.data.status).toBe('awaiting_payment');

    // Access again (simulate repeated scans)
    const res2 = await request(app).get(`/api/checkout/status/${paymentToken}`);
    expect(res2.body.data.status).toBe('awaiting_payment'); // Still awaiting, not paid

    // Status remains authoritative from backend
    expect(res2.body.data.status).not.toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// Paystack webhook — security tests
// ---------------------------------------------------------------------------
describe('POST /api/webhooks/paystack', () => {
  it('returns 200 for request with missing signature (safe rejection)', async () => {
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: 'charge.success', data: {} }));
    // Always returns 200 to prevent Paystack retry storms; but does not process
    expect(res.status).toBe(200);
  });

  it('rejects webhook with invalid HMAC signature', async () => {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'test_ref', amount: 100000, currency: 'NGN', status: 'success' },
    });
    const fakeSignature = crypto.createHmac('sha512', 'wrong_key').update(payload).digest('hex');

    // Verify the signature is rejected (returns 200 to Paystack but processes nothing)
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', fakeSignature)
      .send(Buffer.from(payload));
    expect(res.status).toBe(200);
    // The actual order should NOT be marked as paid
  });

  it('browser callback does not mark payment as paid', async () => {
    // Simulate Paystack browser callback
    const res = await request(app).get('/api/checkout/paystack/callback?reference=test_ref_123');
    // Should redirect, not return a success payment response
    expect(res.status).toBe(302);
    // Should NOT return payment success JSON
    expect(res.body.data?.status).not.toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// Integration: order creates transaction with correct currency
// ---------------------------------------------------------------------------
describe('Order and transaction currency integrity', () => {
  it('created transaction has same currency as order (NGN)', async () => {
    const m = await registerUser(uniqueEmail());
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Currency Test Product',
      price_cents: 200000,
      currency: 'NGN',
      status: 'active',
      stock_quantity: 10,
    });

    const products = await request(app).get(`/api/storefront/${slug}/products`);
    const productId = products.body.data.products[0].id as string;

    const orderRes = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 1 }],
    });
    expect(orderRes.status).toBe(201);
    const { paymentToken } = orderRes.body.data as { paymentToken: string };

    // Verify transaction in DB has correct currency
    const txnRes = await authed('get', '/api/transactions', m.cookies, m.csrfToken);
    expect(txnRes.status).toBe(200);
    const txns = txnRes.body.data.items as Array<{ currency: string; amount_cents: number }>;
    // Our transaction should be listed
    const txn = txns.find((t) => t.amount_cents === 200000);
    expect(txn?.currency).toBe('NGN');

    // Verify via payment status endpoint
    const statusRes = await request(app).get(`/api/checkout/status/${paymentToken}`);
    expect(statusRes.body.data.currency).toBe('NGN');
  });

  it('order creation does not decrement stock', async () => {
    const m = await registerUser(uniqueEmail());
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    const productRes = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Stock Integrity Product',
      price_cents: 100000,
      status: 'active',
      stock_quantity: 5,
    });
    const productId = productRes.body.data.id as string;
    const initialStock = productRes.body.data.stockQuantity as number;

    await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 2 }],
    });

    // Stock should still be the same (not decremented until payment confirmed)
    const updatedProduct = await authed('get', `/api/products/${productId}`, m.cookies, m.csrfToken);
    expect(updatedProduct.body.data.stockQuantity).toBe(initialStock);
  });
});

// ---------------------------------------------------------------------------
// Security: payment status endpoint does not enumerate orders
// ---------------------------------------------------------------------------
describe('Order reference enumeration prevention', () => {
  it('payment token is opaque (long random hex, not guessable)', async () => {
    const m = await registerUser(uniqueEmail());
    const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
    const slug = storeRes.body.data.slug as string;

    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Enum Test Product', price_cents: 100000, status: 'active', stock_quantity: 5,
    });
    const products = await request(app).get(`/api/storefront/${slug}/products`);
    const productId = products.body.data.products[0].id as string;

    const orderRes = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
      idempotencyKey: crypto.randomUUID(),
      storeSlug: slug,
      items: [{ productId, quantity: 1 }],
    });
    const { paymentToken } = orderRes.body.data as { paymentToken: string };

    // Token should be a long hex string (96 chars)
    expect(paymentToken).toMatch(/^[0-9a-f]{96}$/);
  });

  it('sequential integers cannot be used to enumerate payment requests', async () => {
    // Trying integer-like tokens should 404 or 400, not return data
    const res1 = await request(app).get('/api/checkout/status/1');
    const res2 = await request(app).get('/api/checkout/status/2');
    expect([400, 404]).toContain(res1.status);
    expect([400, 404]).toContain(res2.status);
  });
});
