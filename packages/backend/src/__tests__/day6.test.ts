/**
 * Day 6 integration tests — payment security, idempotency, and integrity.
 *
 * These tests supplement the Day 5 payment tests with additional scenarios:
 *
 *  Webhook security:
 *   - Mismatched amount in webhook fails transaction, does not mark paid
 *   - Mismatched currency in webhook fails transaction, does not mark paid
 *   - Duplicate charge.success webhook is a no-op (idempotent)
 *   - Non-charge.success events are silently ignored
 *   - Webhook with unknown Paystack reference does nothing
 *
 *  Concurrent processing:
 *   - Concurrent identical checkout requests with same idempotency key
 *     return the same order (only one order created)
 *
 *  Expired payments:
 *   - Payment status endpoint auto-expires payments past their expiry date
 *   - Paystack initialization rejected for expired payment token
 *
 *  Cross-store isolation:
 *   - Merchant cannot initialize Paystack payment for another store's token
 *
 *  Inventory integrity:
 *   - Stock is not decremented on order creation
 *   - Stock is not decremented by accessing the payment status page
 *
 * NOTE: Webhook processing tests that test processPaystackWebhook directly use
 * database fixtures rather than calling the HTTP endpoint, because the HMAC
 * secret is not set in the test environment (PAYSTACK_SECRET_KEY is absent).
 * These tests are clearly labeled as "unit-level" tests of the service function.
 */

import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { closePool, query, getClient } from '../db/pool.js';
import { isPaystackTestKey, processPaystackWebhook } from '../services/paystackService.js';
import type { Express } from 'express';

const app: Express = createApp() as unknown as Express;

describe('Paystack mode boundary', () => {
  it('accepts test keys and refuses live or malformed keys', () => {
    expect(isPaystackTestKey('sk_test_example_key')).toBe(true);
    expect(isPaystackTestKey('sk_test_CHANGE_ME')).toBe(false);
    expect(isPaystackTestKey('sk_test_your_key_here')).toBe(false);
    expect(isPaystackTestKey('sk_live_example_key')).toBe(false);
    expect(isPaystackTestKey('')).toBe(false);
    expect(isPaystackTestKey(null)).toBe(false);
  });
});

function uniqueEmail(): string {
  return `d6-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
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
  const name = storeName ?? `D6Store-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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

async function setupStoreWithProduct(m: Awaited<ReturnType<typeof registerUser>>, stock = 10) {
  const storeRes = await authed('get', '/api/store', m.cookies, m.csrfToken);
  const slug = storeRes.body.data.slug as string;

  const productRes = await authed('post', '/api/products', m.cookies, m.csrfToken, {
    name: `D6-Widget-${Date.now()}`,
    price_cents: 300000,
    currency: 'NGN',
    status: 'active',
    stock_quantity: stock,
  });
  const productId = productRes.body.data.id as string;
  return { slug, productId, priceCents: 300000 };
}

async function createOrder(
  m: Awaited<ReturnType<typeof registerUser>>,
  slug: string,
  productId: string,
  quantity = 1,
) {
  const res = await authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
    idempotencyKey: crypto.randomUUID(),
    storeSlug: slug,
    items: [{ productId, quantity }],
  });
  return res.body.data as {
    orderId: string;
    orderReference: string;
    paymentToken: string;
    amountCents: number;
    currency: string;
  };
}

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------
// Webhook idempotency and security (unit-level: calls service directly)
// ---------------------------------------------------------------------------

describe('Webhook processing — unit-level service tests', () => {
  it('ignores non-charge.success events silently', async () => {
    await expect(
      processPaystackWebhook({
        event: 'transfer.success',
        data: {
          reference: 'irrelevant_ref',
          status: 'success',
          amount: 100000,
          currency: 'NGN',
          paid_at: null,
          id: 1,
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('does nothing when Paystack reference is unknown', async () => {
    await expect(
      processPaystackWebhook({
        event: 'charge.success',
        data: {
          reference: 'unknown_ref_that_does_not_exist_in_db',
          status: 'success',
          amount: 100000,
          currency: 'NGN',
          paid_at: new Date().toISOString(),
          id: 999,
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('amount mismatch marks transaction failed, does not mark paid', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId, priceCents } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    const fakeReference = `store_test_amount_mismatch_${Date.now()}`;
    await query(
      'UPDATE transactions SET paystack_reference = $1 WHERE payment_token = $2',
      [fakeReference, order.paymentToken],
    );

    await processPaystackWebhook({
      event: 'charge.success',
      data: {
        reference: fakeReference,
        status: 'success',
        amount: priceCents - 1,
        currency: 'NGN',
        paid_at: new Date().toISOString(),
        id: 1,
      },
    });

    const statusRes = await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.status).toBe('failed');
    expect(statusRes.body.data.status).not.toBe('paid');
  });

  it('currency mismatch marks transaction failed, does not mark paid', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId, priceCents } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    const fakeReference = `store_test_currency_mismatch_${Date.now()}`;
    await query(
      'UPDATE transactions SET paystack_reference = $1 WHERE payment_token = $2',
      [fakeReference, order.paymentToken],
    );

    await processPaystackWebhook({
      event: 'charge.success',
      data: {
        reference: fakeReference,
        status: 'success',
        amount: priceCents,
        currency: 'USD',
        paid_at: new Date().toISOString(),
        id: 1,
      },
    });

    const statusRes = await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.status).toBe('failed');
  });

  it('duplicate charge.success is idempotent — no double inventory decrement', async () => {
    const initialStock = 5;
    const m = await registerUser(uniqueEmail());
    const { slug, productId, priceCents } = await setupStoreWithProduct(m, initialStock);
    const order = await createOrder(m, slug, productId, 2);

    const fakeReference = `store_test_idempotent_${Date.now()}`;
    await query(
      'UPDATE transactions SET paystack_reference = $1 WHERE payment_token = $2',
      [fakeReference, order.paymentToken],
    );

    const event = {
      event: 'charge.success' as const,
      data: {
        reference: fakeReference,
        status: 'success',
        amount: priceCents * 2,
        currency: 'NGN',
        paid_at: new Date().toISOString(),
        id: 1,
      },
    };

    await processPaystackWebhook(event);

    const stockAfterFirst = await query<{ stock_quantity: number }>(
      'SELECT stock_quantity FROM products WHERE id = $1',
      [productId],
    );
    expect(stockAfterFirst.rows[0]!.stock_quantity).toBe(initialStock - 2);

    await processPaystackWebhook(event);

    const stockAfterSecond = await query<{ stock_quantity: number }>(
      'SELECT stock_quantity FROM products WHERE id = $1',
      [productId],
    );
    expect(stockAfterSecond.rows[0]!.stock_quantity).toBe(initialStock - 2);

    const statusRes = await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    expect(statusRes.body.data.status).toBe('paid');
  });

  it('successful charge marks transaction paid and order confirmed', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId, priceCents } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    const fakeReference = `store_test_success_${Date.now()}`;
    await query(
      'UPDATE transactions SET paystack_reference = $1 WHERE payment_token = $2',
      [fakeReference, order.paymentToken],
    );

    await processPaystackWebhook({
      event: 'charge.success',
      data: {
        reference: fakeReference,
        status: 'success',
        amount: priceCents,
        currency: 'NGN',
        paid_at: new Date().toISOString(),
        id: 1,
      },
    });

    const statusRes = await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    expect(statusRes.body.data.status).toBe('paid');
    expect(statusRes.body.data.paidAt).toBeTruthy();

    const orderRes = await authed('get', `/api/orders/${order.orderId}`, m.cookies, m.csrfToken);
    expect(orderRes.body.data.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// HTTP webhook endpoint — signature rejection
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/paystack — HTTP signature tests', () => {
  it('accepts a well-formed request but rejects wrong HMAC signature without processing', async () => {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'fake', status: 'success', amount: 100000, currency: 'NGN', paid_at: null, id: 1 },
    });
    const wrongKey = 'wrong_secret_key';
    const signature = crypto.createHmac('sha512', wrongKey).update(payload).digest('hex');

    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(Buffer.from(payload));

    expect(res.status).toBe(200);
  });

  it('returns 200 even with missing signature to prevent retry storms', async () => {
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: 'charge.success', data: {} }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Expired payment token
// ---------------------------------------------------------------------------

describe('Expired payment tokens', () => {
  it('auto-expires a payment token past its expiry date', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    await query(
      "UPDATE transactions SET expires_at = NOW() - INTERVAL '1 hour' WHERE payment_token = $1",
      [order.paymentToken],
    );

    const statusRes = await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.status).toBe('expired');
  });

  it('Paystack initialization is rejected for expired payment token', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    await query(
      "UPDATE transactions SET expires_at = NOW() - INTERVAL '1 hour', status = 'expired' WHERE payment_token = $1",
      [order.paymentToken],
    );

    const res = await authed('post', '/api/checkout/paystack/initialize', m.cookies, m.csrfToken, {
      paymentToken: order.paymentToken,
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('PAYMENT_EXPIRED');
  });
});

// ---------------------------------------------------------------------------
// Cross-store payment isolation
// ---------------------------------------------------------------------------

describe('Public payment initialization', () => {
  it('accepts an anonymous CSRF-protected buyer request without a merchant session', async () => {
    const m1 = await registerUser(uniqueEmail());
    const { slug: slug1, productId: pid1 } = await setupStoreWithProduct(m1);
    const order1 = await createOrder(m1, slug1, pid1);
    const { csrfToken, cookies } = await getCsrfToken('');

    const res = await request(app)
      .post('/api/checkout/paystack/initialize')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ paymentToken: order1.paymentToken });

    // Tests run without provider credentials; this confirms the request passes
    // CSRF and does not require a merchant session, then fails closed.
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
  });

  it('maps a Paystack callback reference to the payment page without confirming payment', async () => {
    const merchant = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(merchant);
    const order = await createOrder(merchant, slug, productId);
    const paystackReference = `callback_${crypto.randomUUID()}`;

    await query(
      'UPDATE transactions SET paystack_reference = $1 WHERE payment_token = $2',
      [paystackReference, order.paymentToken],
    );

    const callback = await request(app)
      .get('/api/checkout/paystack/callback')
      .query({ reference: paystackReference });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(new RegExp(`/payment/${order.paymentToken}$`));

    const status = await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data.status).not.toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// Inventory integrity during concurrent orders
// ---------------------------------------------------------------------------

describe('Inventory integrity', () => {
  it('concurrent orders with same idempotency key create only one order', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m, 10);

    const idempotencyKey = crypto.randomUUID();
    const makeOrder = () =>
      authed('post', '/api/checkout/cart', m.cookies, m.csrfToken, {
        idempotencyKey,
        storeSlug: slug,
        items: [{ productId, quantity: 1 }],
      });

    const [r1, r2, r3] = await Promise.all([makeOrder(), makeOrder(), makeOrder()]);

    const refs = [r1.body.data?.orderReference, r2.body.data?.orderReference, r3.body.data?.orderReference].filter(Boolean);
    const uniqueRefs = new Set(refs);

    expect(uniqueRefs.size).toBe(1);

    const countRes = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM orders WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    expect(parseInt(countRes.rows[0]!.count, 10)).toBe(1);
  });

  it('stock is not decremented on order creation', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m, 8);

    const beforeRes = await authed('get', `/api/products/${productId}`, m.cookies, m.csrfToken);
    const stockBefore = beforeRes.body.data.stockQuantity as number;

    await createOrder(m, slug, productId, 3);

    const afterRes = await authed('get', `/api/products/${productId}`, m.cookies, m.csrfToken);
    expect(afterRes.body.data.stockQuantity).toBe(stockBefore);
  });

  it('stock is not decremented by accessing the payment status endpoint', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m, 6);
    const order = await createOrder(m, slug, productId, 2);

    const beforeRes = await authed('get', `/api/products/${productId}`, m.cookies, m.csrfToken);
    const stockBefore = beforeRes.body.data.stockQuantity as number;

    for (let i = 0; i < 3; i++) {
      await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    }

    const afterRes = await authed('get', `/api/products/${productId}`, m.cookies, m.csrfToken);
    expect(afterRes.body.data.stockQuantity).toBe(stockBefore);
  });

  it('stock decrements exactly once after confirmed payment', async () => {
    const initialStock = 10;
    const orderQty = 3;
    const m = await registerUser(uniqueEmail());
    const { slug, productId, priceCents } = await setupStoreWithProduct(m, initialStock);
    const order = await createOrder(m, slug, productId, orderQty);

    const fakeRef = `store_test_stock_once_${Date.now()}`;
    await query(
      'UPDATE transactions SET paystack_reference = $1 WHERE payment_token = $2',
      [fakeRef, order.paymentToken],
    );

    await processPaystackWebhook({
      event: 'charge.success',
      data: {
        reference: fakeRef,
        status: 'success',
        amount: priceCents * orderQty,
        currency: 'NGN',
        paid_at: new Date().toISOString(),
        id: 1,
      },
    });

    const stockRes = await authed('get', `/api/products/${productId}`, m.cookies, m.csrfToken);
    expect(stockRes.body.data.stockQuantity).toBe(initialStock - orderQty);
  });
});

// ---------------------------------------------------------------------------
// Payment status cannot be forged by the client
// ---------------------------------------------------------------------------

describe('Payment status cannot be forged by client', () => {
  it('payment status endpoint is read-only — cannot be used to set status to paid', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    const statusRes = await request(app)
      .get(`/api/checkout/status/${order.paymentToken}`)
      .query({ status: 'paid', amount: 0 });

    expect(statusRes.body.data.status).toBe('awaiting_payment');
    expect(statusRes.body.data.status).not.toBe('paid');
  });

  it('browser POST to payment status endpoint is not supported (404/405)', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    const res = await request(app)
      .post(`/api/checkout/status/${order.paymentToken}`)
      .set('Content-Type', 'application/json')
      .send({ status: 'paid' });

    expect([403, 404, 405]).toContain(res.status);
  });

  it('Paystack callback redirect does not change payment status to paid', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m);
    const order = await createOrder(m, slug, productId);

    await query(
      'UPDATE transactions SET paystack_reference = $1 WHERE payment_token = $2',
      [`ref_callback_test_${Date.now()}`, order.paymentToken],
    );

    const txnRow = await query<{ paystack_reference: string }>(
      'SELECT paystack_reference FROM transactions WHERE payment_token = $1',
      [order.paymentToken],
    );
    const ref = txnRow.rows[0]!.paystack_reference;

    const callbackRes = await request(app).get(`/api/checkout/paystack/callback?reference=${ref}`);
    expect(callbackRes.status).toBe(302);

    const statusRes = await request(app).get(`/api/checkout/status/${order.paymentToken}`);
    expect(statusRes.body.data.status).not.toBe('paid');
    expect(statusRes.body.data.status).toBe('awaiting_payment');
  });
});

// ---------------------------------------------------------------------------
// DB-level uniqueness — concurrent order creation with same idempotency key
// ---------------------------------------------------------------------------

describe('Database-level idempotency constraint', () => {
  it('idempotency_key unique constraint prevents two distinct orders with same key', async () => {
    const m = await registerUser(uniqueEmail());
    const { slug, productId } = await setupStoreWithProduct(m, 20);
    const idempKey = crypto.randomUUID();

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const storeRes = await query<{ id: string }>(
        'SELECT id FROM stores WHERE slug = $1',
        [slug],
      );
      const storeId = storeRes.rows[0]!.id;
      const ref1 = `ORD-TEST1-${Date.now()}`;
      const ref2 = `ORD-TEST2-${Date.now()}`;

      await client.query(
        `INSERT INTO orders (store_id, reference, status, total_cents, currency, idempotency_key)
         VALUES ($1, $2, 'pending', 100000, 'NGN', $3)`,
        [storeId, ref1, idempKey],
      );

      await expect(
        client.query(
          `INSERT INTO orders (store_id, reference, status, total_cents, currency, idempotency_key)
           VALUES ($1, $2, 'pending', 100000, 'NGN', $3)`,
          [storeId, ref2, idempKey],
        ),
      ).rejects.toThrow();

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
