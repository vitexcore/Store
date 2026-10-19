/**
 * Day 4 integration tests — Store, Products, Inventory, Dashboard.
 *
 * Covers:
 *  - Store access (get own store, cannot access another merchant's store)
 *  - Product CRUD (create, read, update, archive, list with pagination/filtering)
 *  - Product validation (invalid prices, quantities)
 *  - Cross-store access denied
 *  - Inventory summary and stock adjustments
 *  - Inventory concurrency (negative stock prevention)
 *  - Dashboard metrics (calculated from real data, empty store, only confirmed orders count)
 *  - All store-scoped queries are isolated
 */

import request from 'supertest';
import { createApp } from '../app.js';
import { closePool, query } from '../db/pool.js';
import type { Express } from 'express';

const app: Express = createApp() as unknown as Express;

function uniqueEmail(): string {
  return `d4-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
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
  // Use unique store name to avoid slug collisions in parallel tests
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
  };
}

function authed(method: string, path: string, cookies: string, csrf: string, body?: unknown) {
  const req = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
    .set('Cookie', cookies)
    .set('x-csrf-token', csrf)
    .set('Content-Type', 'application/json');
  // Always send a body for state-changing requests so Content-Type is correct
  req.send(body !== undefined ? body : (method !== 'get' ? {} : undefined));
  return req;
}

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------
// Store access
// ---------------------------------------------------------------------------
describe('GET /api/store', () => {
  it('returns the authenticated merchant store', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('get', '/api/store', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe(m.user.storeId);
    expect(res.body.data.name).toBeTruthy();
    // Never expose password_hash or session secrets
    expect(res.body.data.password_hash).toBeUndefined();
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/store');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/store', () => {
  it('updates store description and contactEmail', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('patch', '/api/store', m.cookies, m.csrfToken, {
      description: 'My test store description',
      contactEmail: 'contact@test.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('My test store description');
    expect(res.body.data.contactEmail).toBe('contact@test.com');
  });

  it('rejects description exceeding max length', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('patch', '/api/store', m.cookies, m.csrfToken, {
      description: 'x'.repeat(1001),
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid currency', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('patch', '/api/store', m.cookies, m.csrfToken, {
      defaultCurrency: 'FAKE',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('a merchant cannot update another merchant\'s store by guessing IDs', async () => {
    // The route is always scoped to the session owner — no storeId in path
    const a = await registerUser(uniqueEmail());
    const b = await registerUser(uniqueEmail());
    // Merchant B tries to update their own store — succeeds (sanity check)
    const res = await authed('patch', '/api/store', b.cookies, b.csrfToken, { description: 'B desc' });
    expect(res.status).toBe(200);
    // Merchant A's store is unchanged
    const resA = await authed('get', '/api/store', a.cookies, a.csrfToken);
    expect(resA.body.data.description).not.toBe('B desc');
  });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
describe('Product CRUD', () => {
  it('creates a product with stock fields', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Widget Pro',
      description: 'A great widget',
      price_cents: 2999,
      currency: 'GBP',
      status: 'active',
      stock_quantity: 50,
      low_stock_threshold: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Widget Pro');
    expect(res.body.data.stockQuantity).toBe(50);
    expect(res.body.data.lowStockThreshold).toBe(10);
    expect(res.body.data.priceCents).toBe(2999);
  });

  it('rejects negative price', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Bad Product',
      price_cents: -1,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-integer price', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Bad Product',
      price_cents: 9.99,
    });
    expect(res.status).toBe(400);
  });

  it('rejects negative stock_quantity', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Bad Product',
      price_cents: 100,
      stock_quantity: -5,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects missing name', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      price_cents: 100,
    });
    expect(res.status).toBe(400);
  });

  it('updates a product via PATCH', async () => {
    const m = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Original Name',
      price_cents: 500,
    });
    const id = create.body.data.id as string;
    const res = await authed('patch', `/api/products/${id}`, m.cookies, m.csrfToken, {
      name: 'Updated Name',
      price_cents: 999,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.priceCents).toBe(999);
  });

  it('archives a product', async () => {
    const m = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'To Archive',
      price_cents: 100,
      status: 'active',
    });
    const id = create.body.data.id as string;
    const res = await authed('patch', `/api/products/${id}/archive`, m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('archived');
  });

  it('denies cross-store product access', async () => {
    const a = await registerUser(uniqueEmail());
    const b = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', a.cookies, a.csrfToken, {
      name: 'A Product',
      price_cents: 100,
    });
    const id = create.body.data.id as string;
    // B tries to get A's product
    const res = await authed('get', `/api/products/${id}`, b.cookies, b.csrfToken);
    expect(res.status).toBe(403);
  });

  it('denies cross-store product update', async () => {
    const a = await registerUser(uniqueEmail());
    const b = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', a.cookies, a.csrfToken, {
      name: 'A Product',
      price_cents: 100,
    });
    const id = create.body.data.id as string;
    const res = await authed('patch', `/api/products/${id}`, b.cookies, b.csrfToken, { name: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('denies cross-store archive', async () => {
    const a = await registerUser(uniqueEmail());
    const b = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', a.cookies, a.csrfToken, {
      name: 'A Product',
      price_cents: 100,
    });
    const id = create.body.data.id as string;
    const res = await authed('patch', `/api/products/${id}/archive`, b.cookies, b.csrfToken);
    expect(res.status).toBe(403);
  });
});

describe('Product list — pagination and filtering', () => {
  it('returns paginated products with correct meta', async () => {
    const m = await registerUser(uniqueEmail());
    // Create 3 products
    for (let i = 1; i <= 3; i++) {
      await authed('post', '/api/products', m.cookies, m.csrfToken, {
        name: `Product ${i}`,
        price_cents: i * 100,
        status: i === 3 ? 'archived' : 'active',
      });
    }
    const res = await authed('get', '/api/products?page=1&pageSize=10', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    const { items, meta } = res.body.data;
    expect(items.length).toBe(3);
    expect(meta.total).toBe(3);
    expect(meta.page).toBe(1);
  });

  it('filters by status=active', async () => {
    const m = await registerUser(uniqueEmail());
    await authed('post', '/api/products', m.cookies, m.csrfToken, { name: 'Active P', price_cents: 100, status: 'active' });
    await authed('post', '/api/products', m.cookies, m.csrfToken, { name: 'Draft P', price_cents: 100, status: 'draft' });
    const res = await authed('get', '/api/products?status=active', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((p: { status: string }) => p.status === 'active')).toBe(true);
  });

  it('search filters by name', async () => {
    const m = await registerUser(uniqueEmail());
    const suffix = Date.now();
    await authed('post', '/api/products', m.cookies, m.csrfToken, { name: `UniqueWidget-${suffix}`, price_cents: 100 });
    await authed('post', '/api/products', m.cookies, m.csrfToken, { name: 'Other Product', price_cents: 100 });
    const res = await authed('get', `/api/products?search=UniqueWidget-${suffix}`, m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].name).toContain(`UniqueWidget-${suffix}`);
  });

  it('isolates products between stores', async () => {
    const a = await registerUser(uniqueEmail());
    const b = await registerUser(uniqueEmail());
    await authed('post', '/api/products', a.cookies, a.csrfToken, { name: 'A-Only', price_cents: 100 });
    const res = await authed('get', '/api/products', b.cookies, b.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((p: { name: string }) => !p.name.startsWith('A-Only'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
describe('Inventory', () => {
  it('GET /api/inventory returns stock summary', async () => {
    const m = await registerUser(uniqueEmail());
    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Stocked Item',
      price_cents: 100,
      status: 'active',
      stock_quantity: 25,
      low_stock_threshold: 10,
    });
    const res = await authed('get', '/api/inventory', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.meta).toBeDefined();
  });

  it('adjusts stock upward', async () => {
    const m = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Stock Test',
      price_cents: 100,
      stock_quantity: 10,
    });
    const id = create.body.data.id as string;
    const res = await authed('post', `/api/inventory/${id}/adjust`, m.cookies, m.csrfToken, {
      delta: 5,
      reason: 'Restocked from supplier',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.product.stockQuantity).toBe(15);
    expect(res.body.data.adjustment.delta).toBe(5);
  });

  it('adjusts stock downward', async () => {
    const m = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Stock Down Test',
      price_cents: 100,
      stock_quantity: 20,
    });
    const id = create.body.data.id as string;
    const res = await authed('post', `/api/inventory/${id}/adjust`, m.cookies, m.csrfToken, {
      delta: -8,
      reason: 'Damaged goods',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.product.stockQuantity).toBe(12);
  });

  it('prevents stock going negative', async () => {
    const m = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Zero Stock',
      price_cents: 100,
      stock_quantity: 5,
    });
    const id = create.body.data.id as string;
    const res = await authed('post', `/api/inventory/${id}/adjust`, m.cookies, m.csrfToken, {
      delta: -10,
      reason: 'Too many removed',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects delta of zero', async () => {
    const m = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Delta Zero',
      price_cents: 100,
    });
    const id = create.body.data.id as string;
    const res = await authed('post', `/api/inventory/${id}/adjust`, m.cookies, m.csrfToken, {
      delta: 0,
      reason: 'No change',
    });
    expect(res.status).toBe(400);
  });

  it('denies cross-store inventory adjustment', async () => {
    const a = await registerUser(uniqueEmail());
    const b = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', a.cookies, a.csrfToken, {
      name: 'A Stocked',
      price_cents: 100,
      stock_quantity: 50,
    });
    const id = create.body.data.id as string;
    const res = await authed('post', `/api/inventory/${id}/adjust`, b.cookies, b.csrfToken, {
      delta: -10,
      reason: 'Cross-store attack',
    });
    expect(res.status).toBe(403);
  });

  it('inventory summary excludes archived products', async () => {
    const m = await registerUser(uniqueEmail());
    const create = await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'To Be Archived',
      price_cents: 100,
      status: 'archived',
      stock_quantity: 100,
    });
    const id = create.body.data.id as string;
    // Also create an active one
    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Active Product',
      price_cents: 200,
      status: 'active',
      stock_quantity: 5,
    });
    const res = await authed('get', '/api/inventory', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    const names = res.body.data.items.map((p: { name: string }) => p.name);
    expect(names).not.toContain('To Be Archived');
    expect(names).toContain('Active Product');
  });
});

// ---------------------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------------------
describe('GET /api/dashboard', () => {
  it('returns zero metrics for a brand-new store', async () => {
    const m = await registerUser(uniqueEmail());
    const res = await authed('get', '/api/dashboard', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.totalRevenueCents).toBe(0);
    expect(res.body.data.confirmedOrderCount).toBe(0);
    expect(res.body.data.activeProductCount).toBe(0);
    expect(res.body.data.recentOrders).toHaveLength(0);
  });

  it('counts only confirmed orders toward revenue', async () => {
    const m = await registerUser(uniqueEmail());
    const storeId = m.user.storeId;
    const suffix = Date.now();

    // Insert a confirmed order directly (would normally come via checkout)
    await query(
      `INSERT INTO orders (store_id, reference, status, total_cents, currency)
       VALUES ($1, $2, 'confirmed', 5000, 'GBP')`,
      [storeId, `CONF-${suffix}`],
    );
    // Insert a pending order (should NOT count toward revenue)
    await query(
      `INSERT INTO orders (store_id, reference, status, total_cents, currency)
       VALUES ($1, $2, 'pending', 3000, 'GBP')`,
      [storeId, `PEND-${suffix}`],
    );

    const res = await authed('get', '/api/dashboard', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.totalRevenueCents).toBe(5000); // only confirmed
    expect(res.body.data.confirmedOrderCount).toBe(1);
  });

  it('counts active products correctly', async () => {
    const m = await registerUser(uniqueEmail());
    await authed('post', '/api/products', m.cookies, m.csrfToken, { name: 'Active 1', price_cents: 100, status: 'active' });
    await authed('post', '/api/products', m.cookies, m.csrfToken, { name: 'Active 2', price_cents: 200, status: 'active' });
    await authed('post', '/api/products', m.cookies, m.csrfToken, { name: 'Draft 1', price_cents: 300, status: 'draft' });
    const res = await authed('get', '/api/dashboard', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.activeProductCount).toBe(2);
  });

  it('counts low-stock products based on threshold', async () => {
    const m = await registerUser(uniqueEmail());
    // Low stock (qty 3 <= threshold 5)
    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'Low Stock Item', price_cents: 100, status: 'active',
      stock_quantity: 3, low_stock_threshold: 5,
    });
    // OK stock (qty 10 > threshold 5)
    await authed('post', '/api/products', m.cookies, m.csrfToken, {
      name: 'OK Stock Item', price_cents: 100, status: 'active',
      stock_quantity: 10, low_stock_threshold: 5,
    });
    const res = await authed('get', '/api/dashboard', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.lowStockProductCount).toBe(1);
  });

  it('does not leak another store\'s metrics', async () => {
    const a = await registerUser(uniqueEmail());
    const b = await registerUser(uniqueEmail());
    // Add a confirmed order to store A
    await query(
      `INSERT INTO orders (store_id, reference, status, total_cents, currency)
       VALUES ($1, $2, 'confirmed', 9999, 'GBP')`,
      [a.user.storeId, `ISO-${Date.now()}`],
    );
    // B's dashboard should show zero revenue
    const res = await authed('get', '/api/dashboard', b.cookies, b.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.totalRevenueCents).toBe(0);
    expect(res.body.data.confirmedOrderCount).toBe(0);
  });

  it('recent orders list is limited to 5 entries', async () => {
    const m = await registerUser(uniqueEmail());
    const ts = Date.now();
    for (let i = 0; i < 7; i++) {
      await query(
        `INSERT INTO orders (store_id, reference, status, total_cents, currency)
         VALUES ($1, $2, 'pending', 1000, 'GBP')`,
        [m.user.storeId, `ORD-${ts}-${i}`],
      );
    }
    const res = await authed('get', '/api/dashboard', m.cookies, m.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.recentOrders.length).toBeLessThanOrEqual(5);
  });
});
