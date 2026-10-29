/**
 * Inventory alerts & restock recommendations tests.
 *
 * Verifies:
 *  - Deterministic alert calculations:
 *      * Low-stock: stock > 0 AND stock <= low_stock_threshold (active)
 *      * Out-of-stock: stock_quantity = 0
 *      * Inactive: status <> 'active' (draft/archived)
 *  - One alert per product (no duplicate alert rows for the same condition)
 *  - Alerts resolve when stock changes (dynamic calculation, no stale state)
 *  - Severity assignment (critical for out-of-stock / critically low)
 *  - Cross-merchant isolation (session-scoped store identity)
 *  - Restock recommendations from completed-sales velocity
 *  - Restock recommendations with insufficient historical data
 *  - Authentication enforcement on alert routes
 */

import request from 'supertest';
import { createApp } from '../app.js';
import { closePool, query } from '../db/pool.js';
import type { Express } from 'express';

const app: Express = createApp() as unknown as Express;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(): string {
  return `inv-alert-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
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
  const storeName = `Alert Store ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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

async function insertProduct(
  storeId: string,
  name: string,
  stockQuantity: number,
  lowStockThreshold: number = 5,
  status: 'active' | 'draft' | 'archived' = 'active',
): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO products (store_id, name, stock_quantity, low_stock_threshold, status, price_cents, currency)
     VALUES ($1, $2, $3, $4, $5, 10000, 'NGN')
     RETURNING id`,
    [storeId, name, stockQuantity, lowStockThreshold, status],
  );
  return res.rows[0]!.id;
}

async function fetchAlerts(merchant: TestMerchant): Promise<request.Response> {
  return request(app)
    .get('/api/inventory/alerts')
    .set('Cookie', merchant.cookies);
}

async function fetchRestock(merchant: TestMerchant): Promise<request.Response> {
  return request(app)
    .get('/api/inventory/restock-recommendations')
    .set('Cookie', merchant.cookies);
}

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------
// 1. Alert status calculations
// ---------------------------------------------------------------------------

describe('GET /api/inventory/alerts — deterministic alert calculations', () => {
  it('generates one alert per product with correct type and severity', async () => {
    const merchant = await registerMerchant();
    const storeId = merchant.storeId;

    // Active, well stocked — no alert
    await insertProduct(storeId, 'Well Stocked', 25, 5, 'active');
    // Low stock: active, stock 3 <= threshold 5 — warning
    await insertProduct(storeId, 'Low Stock Item', 3, 5, 'active');
    // Critically low: active, stock 1 <= half of threshold 5 — critical
    await insertProduct(storeId, 'Critical Item', 1, 5, 'active');
    // Out of stock: active, stock 0 — critical
    await insertProduct(storeId, 'Out of Stock Item', 0, 5, 'active');
    // Inactive draft with stock — warning (info if archived)
    await insertProduct(storeId, 'Draft Item', 10, 5, 'draft');

    const res = await fetchAlerts(merchant);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const alerts = res.body.data.alerts;
    const names = alerts.map((a: { name: string }) => a.name);

    expect(names).not.toContain('Well Stocked');
    expect(names).toContain('Low Stock Item');
    expect(names).toContain('Critical Item');
    expect(names).toContain('Out of Stock Item');
    expect(names).toContain('Draft Item');

    // One alert per product (no duplicates)
    const ids = alerts.map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Severity checks
    const outOfStock = alerts.find((a: { name: string }) => a.name === 'Out of Stock Item');
    expect(outOfStock?.type).toBe('out_of_stock');
    expect(outOfStock?.severity).toBe('critical');

    const critical = alerts.find((a: { name: string }) => a.name === 'Critical Item');
    expect(critical?.type).toBe('low_stock');
    expect(critical?.severity).toBe('critical');

    const low = alerts.find((a: { name: string }) => a.name === 'Low Stock Item');
    expect(low?.type).toBe('low_stock');
    expect(low?.severity).toBe('warning');

    const draft = alerts.find((a: { name: string }) => a.name === 'Draft Item');
    expect(draft?.type).toBe('inactive');

    // Counts
    expect(res.body.data.counts.outOfStock).toBe(1);
    expect(res.body.data.counts.lowStock).toBe(2);
    expect(res.body.data.counts.inactive).toBe(1);
    expect(res.body.data.counts.total).toBe(4);
    expect(res.body.data.counts.critical).toBe(2);
  });

  it('low-stock active product is NOT marked unavailable (still purchasable)', async () => {
    const merchant = await registerMerchant();
    await insertProduct(merchant.storeId, 'Still Purchasable', 2, 5, 'active');

    const res = await fetchAlerts(merchant);
    const alert = res.body.data.alerts.find((a: { name: string }) => a.name === 'Still Purchasable');
    expect(alert?.type).toBe('low_stock');
    expect(alert?.unavailable).toBe(false);
  });

  it('keeps summary counts accurate when displayed alerts are limited', async () => {
    const merchant = await registerMerchant();
    for (let i = 0; i < 55; i += 1) {
      await insertProduct(merchant.storeId, `Out Item ${i}`, 0, 5, 'active');
    }

    const res = await fetchAlerts(merchant);
    expect(res.status).toBe(200);
    expect(res.body.data.alerts).toHaveLength(50);
    expect(res.body.data.counts.outOfStock).toBe(55);
    expect(res.body.data.counts.total).toBe(55);
  });

  it('does not let non-alert products consume the alert display limit', async () => {
    const merchant = await registerMerchant();
    for (let i = 0; i < 50; i += 1) {
      await insertProduct(merchant.storeId, `Healthy ${i}`, 6, 5, 'active');
    }
    await insertProduct(merchant.storeId, 'Inactive With Stock', 100, 5, 'draft');

    const res = await fetchAlerts(merchant);
    expect(res.status).toBe(200);
    expect(res.body.data.alerts).toHaveLength(1);
    expect(res.body.data.alerts[0]?.name).toBe('Inactive With Stock');
    expect(res.body.data.alerts[0]?.type).toBe('inactive');
    expect(res.body.data.counts.inactive).toBe(1);
  });

  it('resolves alerts when stock changes via adjustment', async () => {
    const merchant = await registerMerchant();
    const productId = await insertProduct(merchant.storeId, 'Resolve Me', 1, 5, 'active');

    // Initially low stock
    let res = await fetchAlerts(merchant);
    expect(res.body.data.alerts.some((a: { productId: string }) => a.productId === productId)).toBe(true);

    // Restock above threshold via the adjust endpoint
    const { csrfToken } = await getCsrfToken(merchant.cookies);
    await request(app)
      .post(`/api/inventory/${productId}/adjust`)
      .set('Cookie', merchant.cookies)
      .set('x-csrf-token', csrfToken)
      .send({ delta: 10, reason: 'Restocked' });

    // Alert should now be resolved
    res = await fetchAlerts(merchant);
    expect(res.body.data.alerts.some((a: { productId: string }) => a.productId === productId)).toBe(false);
    expect(res.body.data.counts.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-merchant isolation
// ---------------------------------------------------------------------------

describe('Cross-merchant isolation for inventory alerts', () => {
  it('never leaks merchant B products or alerts to merchant A', async () => {
    const merchantA = await registerMerchant();
    const merchantB = await registerMerchant();

    await insertProduct(merchantA.storeId, 'Merchant A Item', 0, 5, 'active');
    await insertProduct(merchantB.storeId, 'Merchant B Secret', 1, 10, 'active');

    const resA = await fetchAlerts(merchantA);
    const resB = await fetchAlerts(merchantB);

    expect(resA.body.data.alerts.map((a: { name: string }) => a.name)).toEqual(['Merchant A Item']);
    expect(resB.body.data.alerts.map((a: { name: string }) => a.name)).toEqual(['Merchant B Secret']);
    expect(resA.body.data.counts.total).toBe(1);
    expect(resB.body.data.counts.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Restock recommendations
// ---------------------------------------------------------------------------

describe('GET /api/inventory/restock-recommendations', () => {
  it('prioritizes out-of-stock and low-stock products with sales velocity', async () => {
    const merchant = await registerMerchant();
    const storeId = merchant.storeId;

    // Out-of-stock product that recently sold
    const outOfStockId = await insertProduct(storeId, 'Sold Out Fast', 0, 5, 'active');
    // Low stock product
    await insertProduct(storeId, 'Running Low', 2, 5, 'active');
    // Well-stocked product (no recommendation)
    await insertProduct(storeId, 'Well Stocked', 50, 5, 'active');

    // Create completed sales for 'Sold Out Fast' in the last 30 days
    const today = new Date().toISOString().slice(0, 10);
    const orderRef = `RESTOCK-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const orderRes = await query<{ id: string }>(
      `INSERT INTO orders (store_id, reference, status, total_cents, currency)
       VALUES ($1, $2, 'confirmed', 10000, 'NGN')
       RETURNING id`,
      [storeId, orderRef],
    );
    const orderId = orderRes.rows[0]!.id;
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, total_cents)
       VALUES ($1, $2, 'Sold Out Fast', 10, 1000, 10000)`,
      [orderId, outOfStockId],
    );
    const paymentToken = `txn_restock_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    await query(
      `INSERT INTO transactions (store_id, order_id, payment_token, status, amount_cents, currency, paid_at)
       VALUES ($1, $2, $3, 'paid', 10000, 'NGN', $4)`,
      [storeId, orderId, paymentToken, `${today}T10:00:00Z`],
    );

    const res = await fetchRestock(merchant);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const recommendations = res.body.data.recommendations;
    expect(Array.isArray(recommendations)).toBe(true);
    // Out-of-stock product should be first (highest priority)
    expect(recommendations[0]?.name).toBe('Sold Out Fast');
    expect(recommendations[0]?.currentStock).toBe(0);
    expect(recommendations[0]?.unitsSoldRecent).toBe(10);
    expect(recommendations[0]?.suggestedQuantity).not.toBeNull();
  });

  it('returns recommendations for low-stock products but no quantity when there are no sales', async () => {
    const merchant = await registerMerchant();
    await insertProduct(merchant.storeId, 'No Sales Item', 1, 5, 'active');
    await insertProduct(merchant.storeId, 'Archived Item', 0, 5, 'archived');

    const res = await fetchRestock(merchant);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const recommendations = res.body.data.recommendations;
    // The below-threshold product is still flagged, but without a suggested quantity.
    expect(recommendations.length).toBe(1);
    expect(recommendations[0]?.name).toBe('No Sales Item');
    expect(recommendations[0]?.currentStock).toBe(1);
    expect(recommendations[0]?.suggestedQuantity).toBeNull();
    expect(recommendations[0]?.dataReliable).toBe(false);
    expect(typeof res.body.data.dataCoverageNote).toBe('string');
    expect(res.body.data.dataCoverageNote).toContain('No completed sales');
  });

  it('uses sales coverage per product and excludes products unavailable for sale', async () => {
    const merchant = await registerMerchant();
    const soldId = await insertProduct(merchant.storeId, 'Observed Demand', 1, 5, 'active');
    await insertProduct(merchant.storeId, 'No Product History', 2, 5, 'active');
    await insertProduct(merchant.storeId, 'Draft Product', 0, 5, 'draft');

    const today = new Date().toISOString().slice(0, 10);
    const orderRes = await query<{ id: string }>(
      `INSERT INTO orders (store_id, reference, status, total_cents, currency)
       VALUES ($1, $2, 'confirmed', 2000, 'NGN') RETURNING id`,
      [merchant.storeId, `RESTOCK-COVERAGE-${Date.now()}`],
    );
    const orderId = orderRes.rows[0]!.id;
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, total_cents)
       VALUES ($1, $2, 'Observed Demand', 4, 500, 2000)`,
      [orderId, soldId],
    );
    await query(
      `INSERT INTO transactions (store_id, order_id, payment_token, status, amount_cents, currency, paid_at)
       VALUES ($1, $2, $3, 'paid', 2000, 'NGN', $4)`,
      [merchant.storeId, orderId, `txn-coverage-${Date.now()}`, `${today}T10:00:00Z`],
    );

    const res = await fetchRestock(merchant);
    expect(res.status).toBe(200);
    const recommendations = res.body.data.recommendations;
    expect(recommendations.map((item: { name: string }) => item.name)).not.toContain('Draft Product');

    const observed = recommendations.find((item: { name: string }) => item.name === 'Observed Demand');
    expect(observed.unitsSoldRecent).toBe(4);
    expect(observed.dataReliable).toBe(true);
    expect(observed.suggestedQuantity).toBeGreaterThan(0);

    const unobserved = recommendations.find((item: { name: string }) => item.name === 'No Product History');
    expect(unobserved.unitsSoldRecent).toBe(0);
    expect(unobserved.dataReliable).toBe(false);
    expect(unobserved.suggestedQuantity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Authentication enforcement
// ---------------------------------------------------------------------------

describe('Alert routes require authentication', () => {
  it('rejects unauthenticated requests to /api/inventory/alerts with 401', async () => {
    const res = await request(app).get('/api/inventory/alerts');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects unauthenticated requests to /api/inventory/restock-recommendations with 401', async () => {
    const res = await request(app).get('/api/inventory/restock-recommendations');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});
