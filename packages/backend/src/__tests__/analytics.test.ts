/**
 * Sales analytics integration tests.
 *
 * Verifies the deterministic definitions used by the merchant dashboard:
 *  - only confirmed orders with a verified paid transaction count,
 *  - sales are dated by the first verified payment time,
 *  - calendar boundaries use the configured analytics timezone (Africa/Lagos),
 *  - the immediately preceding equivalent period is used for comparisons,
 *  - product rankings include snapshot names for deleted products,
 *  - store isolation and input validation hold on the API.
 */

import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { closePool, query } from '../db/pool.js';
import type { Express } from 'express';

const app: Express = createApp() as unknown as Express;

function uniqueEmail(): string {
  return `analytics-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
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

interface TestMerchant {
  cookies: string;
  csrfToken: string;
  storeId: string;
}

async function registerMerchant(): Promise<TestMerchant> {
  const email = uniqueEmail();
  const storeName = `Analytics Store ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const { csrfToken: t1, cookies: c1 } = await getCsrfToken('');
  const res = await request(app)
    .post('/api/auth/register')
    .set('Cookie', c1)
    .set('x-csrf-token', t1)
    .send({ email, password: 'TestPass123!', storeName });

  if (res.status !== 201) {
    throw new Error(`Registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const cookies = mergeCookies(c1, extractCookies(res));
  const { csrfToken, cookies: finalCookies } = await getCsrfToken(cookies);
  return {
    cookies: finalCookies,
    csrfToken,
    storeId: res.body.data.user.storeId as string,
  };
}

async function createProduct(storeId: string, name: string, priceCents = 1000): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO products (store_id, name, price_cents, currency, status, stock_quantity)
     VALUES ($1, $2, $3, 'NGN', 'active', 100)
     RETURNING id`,
    [storeId, name, priceCents],
  );
  return res.rows[0]!.id;
}

interface SaleInput {
  reference: string;
  totalCents: number;
  orderStatus?: string;
  orderCurrency?: string;
  item?: { productId: string | null; name: string; quantity: number; unitPriceCents: number };
  transactions?: Array<{
    status: string;
    paidAt: string | null;
    amountCents?: number;
    currency?: string;
  }>;
}

async function insertSale(storeId: string, input: SaleInput): Promise<string> {
  const orderRes = await query<{ id: string }>(
    `INSERT INTO orders (store_id, reference, status, total_cents, currency)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      storeId,
      input.reference,
      input.orderStatus ?? 'confirmed',
      input.totalCents,
      input.orderCurrency ?? 'NGN',
    ],
  );
  const orderId = orderRes.rows[0]!.id;

  if (input.item) {
    await query(
      `INSERT INTO order_items
         (order_id, product_id, product_name, quantity, unit_price_cents, total_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orderId,
        input.item.productId,
        input.item.name,
        input.item.quantity,
        input.item.unitPriceCents,
        input.item.unitPriceCents * input.item.quantity,
      ],
    );
  }

  for (const txn of input.transactions ?? []) {
    await query(
      `INSERT INTO transactions
         (store_id, order_id, payment_token, status, amount_cents, currency, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        storeId,
        orderId,
        `analytics_${crypto.randomUUID()}`,
        txn.status,
        txn.amountCents ?? input.totalCents,
        txn.currency ?? input.orderCurrency ?? 'NGN',
        txn.paidAt,
      ],
    );
  }

  return orderId;
}

function paid(paidAt: string) {
  return { status: 'paid', paidAt };
}

async function getAnalytics(
  merchant: TestMerchant,
  queryParams: Record<string, string> = {},
): Promise<request.Response> {
  return request(app)
    .get('/api/analytics/sales')
    .query(queryParams)
    .set('Cookie', merchant.cookies);
}

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------
// Authentication and validation
// ---------------------------------------------------------------------------

describe('GET /api/analytics/sales — access and validation', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/analytics/sales');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('defaults to the last 7 calendar days', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant);
    expect(res.status).toBe(200);
    expect(res.body.data.range.preset).toBe('7d');
    expect(res.body.data.range.days).toBe(7);
    expect(res.body.data.range.timezone).toBe('Africa/Lagos');
    expect(res.body.data.currency).toBe('NGN');
  });

  it('rejects an unknown preset', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant, { preset: 'year' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a preset combined with custom dates', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant, {
      preset: '7d',
      start: '2026-03-01',
      end: '2026-03-07',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a custom range with only one date', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant, { start: '2026-03-01' });
    expect(res.status).toBe(400);
  });

  it('rejects an impossible calendar date', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant, { start: '2026-02-30', end: '2026-03-07' });
    expect(res.status).toBe(400);
  });

  it('rejects a reversed range', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant, { start: '2026-03-07', end: '2026-03-01' });
    expect(res.status).toBe(400);
  });

  it('rejects a range longer than 366 days', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant, { start: '2024-01-01', end: '2025-01-02' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

describe('GET /api/analytics/sales — metrics', () => {
  it('returns deterministic revenue, comparison, daily, and product rankings', async () => {
    const merchant = await registerMerchant();
    const { storeId } = merchant;
    const suffix = crypto.randomUUID().slice(0, 8);

    const alpha = await createProduct(storeId, `Alpha ${suffix}`, 100000);
    const beta = await createProduct(storeId, `Beta ${suffix}`, 10000);
    const gamma = await createProduct(storeId, `Gamma ${suffix}`, 25000);
    const legacy = await createProduct(storeId, `Legacy ${suffix}`, 30000);

    await insertSale(storeId, {
      reference: `AN-${suffix}-1`,
      totalCents: 200000,
      item: { productId: alpha, name: `Alpha ${suffix}`, quantity: 2, unitPriceCents: 100000 },
      transactions: [paid('2026-03-02T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-2`,
      totalCents: 50000,
      item: { productId: beta, name: `Beta ${suffix}`, quantity: 5, unitPriceCents: 10000 },
      transactions: [paid('2026-03-03T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-3`,
      totalCents: 75000,
      item: { productId: gamma, name: `Gamma ${suffix}`, quantity: 3, unitPriceCents: 25000 },
      transactions: [paid('2026-03-05T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-4`,
      totalCents: 30000,
      item: { productId: legacy, name: `Legacy ${suffix}`, quantity: 1, unitPriceCents: 30000 },
      transactions: [paid('2026-03-06T10:00:00Z')],
    });

    await insertSale(storeId, {
      reference: `AN-${suffix}-P1`,
      totalCents: 120000,
      item: { productId: alpha, name: `Alpha ${suffix}`, quantity: 1, unitPriceCents: 120000 },
      transactions: [paid('2026-02-24T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-P2`,
      totalCents: 80000,
      item: { productId: alpha, name: `Alpha ${suffix}`, quantity: 1, unitPriceCents: 80000 },
      transactions: [paid('2026-02-27T10:00:00Z')],
    });

    // Deleting the product must not erase its historical contribution.
    await query('DELETE FROM products WHERE id = $1', [legacy]);

    const res = await getAnalytics(merchant, { start: '2026-03-01', end: '2026-03-07' });
    expect(res.status).toBe(200);

    const data = res.body.data;
    expect(data.currency).toBe('NGN');
    expect(data.range).toMatchObject({
      start: '2026-03-01',
      end: '2026-03-07',
      preset: 'custom',
      timezone: 'Africa/Lagos',
      days: 7,
    });

    expect(data.revenueCents).toBe(355000);
    expect(data.completedOrderCount).toBe(4);
    expect(data.averageOrderValueCents).toBe(88750);

    expect(data.comparison).toMatchObject({
      start: '2026-02-22',
      end: '2026-02-28',
      revenueCents: 200000,
      completedOrderCount: 2,
      averageOrderValueCents: 100000,
      revenueChangeCents: 155000,
      revenueChangePercent: 77.5,
      orderCountChange: 2,
      orderCountChangePercent: 100,
    });

    expect(data.daily).toHaveLength(7);
    expect(data.daily.map((d: { date: string }) => d.date)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
    ]);
    expect(data.daily[1]).toMatchObject({ date: '2026-03-02', revenueCents: 200000, orderCount: 1 });
    expect(data.daily[2]).toMatchObject({ date: '2026-03-03', revenueCents: 50000, orderCount: 1 });
    expect(data.daily[3]).toMatchObject({ date: '2026-03-04', revenueCents: 0, orderCount: 0 });
    expect(data.daily[4]).toMatchObject({ date: '2026-03-05', revenueCents: 75000, orderCount: 1 });
    expect(data.daily[5]).toMatchObject({ date: '2026-03-06', revenueCents: 30000, orderCount: 1 });

    expect(
      data.topProducts.map((p: { name: string; quantitySold: number }) => [p.name, p.quantitySold]),
    ).toEqual([
      [`Beta ${suffix}`, 5],
      [`Gamma ${suffix}`, 3],
      [`Alpha ${suffix}`, 2],
      [`Legacy ${suffix}`, 1],
    ]);
    expect(data.topProducts[3].productId).toBeNull();

    expect(
      data.slowestProducts.map((p: { name: string; quantitySold: number }) => [p.name, p.quantitySold]),
    ).toEqual([
      [`Legacy ${suffix}`, 1],
      [`Alpha ${suffix}`, 2],
      [`Gamma ${suffix}`, 3],
      [`Beta ${suffix}`, 5],
    ]);

    expect(Array.isArray(data.limitations)).toBe(true);
    expect(data.limitations.length).toBeGreaterThan(0);
  });

  it('uses the analytics timezone for range boundaries and daily grouping', async () => {
    const merchant = await registerMerchant();
    const { storeId } = merchant;
    const suffix = crypto.randomUUID().slice(0, 8);
    const product = await createProduct(storeId, `Boundary ${suffix}`, 100);

    const item = { productId: product, name: `Boundary ${suffix}`, quantity: 1, unitPriceCents: 100 };

    // 2026-02-28 23:30 UTC = 2026-03-01 00:30 in Africa/Lagos (included).
    await insertSale(storeId, {
      reference: `AN-${suffix}-b1`,
      totalCents: 100,
      item,
      transactions: [paid('2026-02-28T23:30:00Z')],
    });
    // 2026-02-28 22:30 UTC = 2026-02-28 23:30 Lagos (previous period only).
    await insertSale(storeId, {
      reference: `AN-${suffix}-b2`,
      totalCents: 200,
      item,
      transactions: [paid('2026-02-28T22:30:00Z')],
    });
    // 2026-03-07 22:59 UTC = 2026-03-07 23:59 Lagos (included).
    await insertSale(storeId, {
      reference: `AN-${suffix}-b3`,
      totalCents: 300,
      item,
      transactions: [paid('2026-03-07T22:59:00Z')],
    });
    // 2026-03-07 23:00 UTC = 2026-03-08 00:00 Lagos (excluded from both).
    await insertSale(storeId, {
      reference: `AN-${suffix}-b4`,
      totalCents: 400,
      item,
      transactions: [paid('2026-03-07T23:00:00Z')],
    });

    const res = await getAnalytics(merchant, { start: '2026-03-01', end: '2026-03-07' });
    expect(res.status).toBe(200);

    expect(res.body.data.revenueCents).toBe(400);
    expect(res.body.data.completedOrderCount).toBe(2);
    expect(res.body.data.daily[0]).toMatchObject({ date: '2026-03-01', revenueCents: 100, orderCount: 1 });
    expect(res.body.data.daily[6]).toMatchObject({ date: '2026-03-07', revenueCents: 300, orderCount: 1 });
    expect(res.body.data.comparison.revenueCents).toBe(200);
    expect(res.body.data.comparison.completedOrderCount).toBe(1);
  });

  it('excludes unverified and non-confirmed orders, and counts each order once', async () => {
    const merchant = await registerMerchant();
    const { storeId } = merchant;
    const suffix = crypto.randomUUID().slice(0, 8);
    const product = await createProduct(storeId, `Exclusion ${suffix}`, 5000);
    const item = { productId: product, name: `Exclusion ${suffix}`, quantity: 1, unitPriceCents: 5000 };

    await insertSale(storeId, {
      reference: `AN-${suffix}-ok`,
      totalCents: 5000,
      item,
      transactions: [paid('2026-03-02T10:00:00Z'), paid('2026-03-04T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-pending`,
      totalCents: 11000,
      orderStatus: 'pending',
      item,
      transactions: [paid('2026-03-02T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-unpaid`,
      totalCents: 12000,
      item,
      transactions: [{ status: 'pending', paidAt: null }],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-failed`,
      totalCents: 13000,
      item,
      transactions: [{ status: 'failed', paidAt: null }],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-cancelled`,
      totalCents: 14000,
      orderStatus: 'cancelled',
      item,
      transactions: [paid('2026-03-02T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-refunded`,
      totalCents: 15000,
      orderStatus: 'refunded',
      item,
      transactions: [paid('2026-03-02T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-gbp`,
      totalCents: 16000,
      orderCurrency: 'GBP',
      item,
      transactions: [paid('2026-03-02T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-no-txn`,
      totalCents: 17000,
      item,
    });

    const res = await getAnalytics(merchant, { start: '2026-03-01', end: '2026-03-07' });
    expect(res.status).toBe(200);

    expect(res.body.data.revenueCents).toBe(5000);
    expect(res.body.data.completedOrderCount).toBe(1);
    expect(res.body.data.topProducts).toHaveLength(1);
    expect(res.body.data.topProducts[0].quantitySold).toBe(1);
    // The sale uses the first verified payment date, not the later duplicate.
    expect(res.body.data.daily[1]).toMatchObject({ date: '2026-03-02', revenueCents: 5000, orderCount: 1 });
    expect(res.body.data.daily[3]).toMatchObject({ date: '2026-03-04', revenueCents: 0, orderCount: 0 });
  });

  it('rounds average order value and reports a null change when the prior period is empty', async () => {
    const merchant = await registerMerchant();
    const { storeId } = merchant;
    const suffix = crypto.randomUUID().slice(0, 8);

    await insertSale(storeId, {
      reference: `AN-${suffix}-r1`,
      totalCents: 100,
      transactions: [paid('2026-03-02T10:00:00Z')],
    });
    await insertSale(storeId, {
      reference: `AN-${suffix}-r2`,
      totalCents: 201,
      transactions: [paid('2026-03-03T10:00:00Z')],
    });

    const res = await getAnalytics(merchant, { start: '2026-03-01', end: '2026-03-07' });
    expect(res.status).toBe(200);

    expect(res.body.data.revenueCents).toBe(301);
    expect(res.body.data.completedOrderCount).toBe(2);
    expect(res.body.data.averageOrderValueCents).toBe(151);
    expect(res.body.data.comparison.revenueCents).toBe(0);
    expect(res.body.data.comparison.completedOrderCount).toBe(0);
    expect(res.body.data.comparison.averageOrderValueCents).toBe(0);
    expect(res.body.data.comparison.revenueChangePercent).toBeNull();
    expect(res.body.data.comparison.orderCountChangePercent).toBeNull();
    expect(res.body.data.topProducts).toEqual([]);
    expect(res.body.data.slowestProducts).toEqual([]);
  });

  it('returns zeroed metrics for an empty period', async () => {
    const merchant = await registerMerchant();
    const res = await getAnalytics(merchant, { start: '2026-03-01', end: '2026-03-07' });
    expect(res.status).toBe(200);

    expect(res.body.data.revenueCents).toBe(0);
    expect(res.body.data.completedOrderCount).toBe(0);
    expect(res.body.data.averageOrderValueCents).toBe(0);
    expect(res.body.data.daily).toHaveLength(7);
    expect(res.body.data.daily.every((d: { revenueCents: number }) => d.revenueCents === 0)).toBe(true);
  });

  it('ignores a storeId query parameter and isolates stores', async () => {
    const ownerA = await registerMerchant();
    const ownerB = await registerMerchant();
    const suffix = crypto.randomUUID().slice(0, 8);

    await insertSale(ownerB.storeId, {
      reference: `AN-${suffix}-b`,
      totalCents: 99000,
      transactions: [paid('2026-03-02T10:00:00Z')],
    });

    const res = await getAnalytics(ownerA, {
      start: '2026-03-01',
      end: '2026-03-07',
      storeId: ownerB.storeId,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.revenueCents).toBe(0);
    expect(res.body.data.completedOrderCount).toBe(0);
  });
});
