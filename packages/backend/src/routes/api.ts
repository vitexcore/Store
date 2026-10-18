/**
 * API router — mounts all versioned sub-routers.
 *
 * Day 1: Only stub routes are present. Each returns a placeholder JSON response
 * so the frontend can verify connectivity. Full implementations added in later days.
 *
 * Every route here will require authentication (Day 2+).
 * Authorization middleware is stubbed below and will be wired up properly then.
 */

import { Router, Request, Response, IRouter } from 'express';
import type { ApiSuccess, ApiError } from '@store/shared';
import { requireAuth, loadUser, requireStore, checkStoreOwnership, denyResourceAccess } from '../auth/middleware.js';
import { query } from '../db/pool.js';

export const apiRouter: IRouter = Router();

// ---------------------------------------------------------------------------
// All /api/* routes require authentication + a store association.
// Identity is derived from the server-side session, never from client input.
// ---------------------------------------------------------------------------
apiRouter.use(requireAuth, loadUser, requireStore);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
apiRouter.get('/dashboard', (_req: Request, res: Response) => {
  const body: ApiSuccess<{ message: string }> = {
    ok: true,
    data: { message: 'Dashboard endpoint — implementation coming in a later day.' },
  };
  res.status(200).json(body);
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
apiRouter.get('/products', async (_req: Request, res: Response) => {
  const storeId = _req.user?.storeId!;
  const result = await query(
    'SELECT id, store_id, name, description, price_cents, currency, status, image_url, created_at, updated_at FROM products WHERE store_id = $1 ORDER BY created_at DESC',
    [storeId],
  );
  const body: ApiSuccess<typeof result.rows> = { ok: true, data: result.rows };
  res.status(200).json(body);
});

apiRouter.get('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await query(
    'SELECT id, store_id, name, description, price_cents, currency, status, image_url, created_at, updated_at FROM products WHERE id = $1',
    [id],
  );
  if (result.rows.length === 0) {
    const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    return res.status(404).json(body);
  }
  const product = result.rows[0]!;
  if (!checkStoreOwnership(product.store_id, req.user?.storeId)) {
    return denyResourceAccess(res);
  }
  const body: ApiSuccess<typeof product> = { ok: true, data: product };
  res.status(200).json(body);
});

apiRouter.post('/products', async (req: Request, res: Response) => {
  const storeId = req.user?.storeId!;
  const { name, description, price_cents, currency, status, image_url } = req.body;

  // Basic validation
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Product name is required (max 200 chars).' };
    return res.status(400).json(body);
  }
  if (typeof price_cents !== 'number' || price_cents < 0 || !Number.isInteger(price_cents)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Price must be a non-negative integer (in cents).' };
    return res.status(400).json(body);
  }
  const allowedCurrencies = ['GBP', 'USD', 'EUR'];
  const finalCurrency = currency && allowedCurrencies.includes(currency) ? currency : 'GBP';
  const allowedStatuses = ['active', 'draft', 'archived'];
  const finalStatus = status && allowedStatuses.includes(status) ? status : 'draft';

  const result = await query(
    `INSERT INTO products (store_id, name, description, price_cents, currency, status, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, store_id, name, description, price_cents, currency, status, image_url, created_at, updated_at`,
    [storeId, name.trim(), (description ?? '').toString().slice(0, 2000), price_cents, finalCurrency, finalStatus, image_url ?? null],
  );
  const created = result.rows[0]!;
  const body: ApiSuccess<typeof created> = { ok: true, data: created };
  res.status(201).json(body);
});

apiRouter.put('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const ownershipCheck = await query('SELECT store_id FROM products WHERE id = $1', [id]);
  if (ownershipCheck.rows.length === 0) {
    const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    return res.status(404).json(body);
  }
  if (!checkStoreOwnership(ownershipCheck.rows[0]!.store_id, req.user?.storeId)) {
    return denyResourceAccess(res);
  }

  const { name, description, price_cents, currency, status, image_url } = req.body;
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Product name must be 1–200 characters.' };
      return res.status(400).json(body);
    }
    updates.push(`name = $${paramIdx++}`);
    params.push(name.trim());
  }
  if (description !== undefined) {
    updates.push(`description = $${paramIdx++}`);
    params.push(description.slice(0, 2000));
  }
  if (price_cents !== undefined) {
    if (typeof price_cents !== 'number' || price_cents < 0 || !Number.isInteger(price_cents)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Price must be a non-negative integer (in cents).' };
      return res.status(400).json(body);
    }
    updates.push(`price_cents = $${paramIdx++}`);
    params.push(price_cents);
  }
  if (currency !== undefined) {
    const allowedCurrencies = ['GBP', 'USD', 'EUR'];
    if (!allowedCurrencies.includes(currency)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Currency must be GBP, USD, or EUR.' };
      return res.status(400).json(body);
    }
    updates.push(`currency = $${paramIdx++}`);
    params.push(currency);
  }
  if (status !== undefined) {
    const allowedStatuses = ['active', 'draft', 'archived'];
    if (!allowedStatuses.includes(status)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Status must be active, draft, or archived.' };
      return res.status(400).json(body);
    }
    updates.push(`status = $${paramIdx++}`);
    params.push(status);
  }
  if (image_url !== undefined) {
    updates.push(`image_url = $${paramIdx++}`);
    params.push(image_url);
  }

  if (updates.length === 0) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'No fields to update.' };
    return res.status(400).json(body);
  }

  updates.push(`updated_at = NOW()`);
  params.push(id);
  const result = await query(
    `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, store_id, name, description, price_cents, currency, status, image_url, created_at, updated_at`,
    params,
  );
  const updated = result.rows[0]!;
    const body: ApiSuccess<typeof updated> = { ok: true, data: updated };
  res.status(200).json(body);
});

apiRouter.delete('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const ownershipCheck = await query('SELECT store_id FROM products WHERE id = $1', [id]);
  if (ownershipCheck.rows.length === 0) {
    const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    return res.status(404).json(body);
  }
  if (!checkStoreOwnership(ownershipCheck.rows[0]!.store_id, req.user?.storeId)) {
    return denyResourceAccess(res);
  }
  await query('DELETE FROM products WHERE id = $1', [id]);
  const body: ApiSuccess<null> = { ok: true, data: null };
  res.status(204).json(body);
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
apiRouter.get('/orders', async (req: Request, res: Response) => {
  const storeId = req.user?.storeId!;
  const result = await query(
    'SELECT id, store_id, reference, status, total_cents, currency, customer_name, customer_email, created_at, updated_at FROM orders WHERE store_id = $1 ORDER BY created_at DESC',
    [storeId],
  );
  const body: ApiSuccess<typeof result.rows> = { ok: true, data: result.rows };
  res.status(200).json(body);
});

apiRouter.get('/orders/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await query(
    'SELECT id, store_id, reference, status, total_cents, currency, customer_name, customer_email, created_at, updated_at FROM orders WHERE id = $1',
    [id],
  );
  if (result.rows.length === 0) {
    const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Order not found.' };
    return res.status(404).json(body);
  }
  const order = result.rows[0]!;
  if (!checkStoreOwnership(order.store_id, req.user?.storeId)) {
    return denyResourceAccess(res);
  }
  const body: ApiSuccess<typeof order> = { ok: true, data: order };
  res.status(200).json(body);
});

apiRouter.post('/orders', async (req: Request, res: Response) => {
  const storeId = req.user?.storeId!;
  const { reference, total_cents, currency, customer_name, customer_email, status } = req.body;

  if (!reference || typeof reference !== 'string' || reference.length < 1 || reference.length > 64) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Order reference is required (1–64 chars).' };
    return res.status(400).json(body);
  }
  if (typeof total_cents !== 'number' || total_cents < 0 || !Number.isInteger(total_cents)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Total must be a non-negative integer (in cents).' };
    return res.status(400).json(body);
  }
  const allowedCurrencies = ['GBP', 'USD', 'EUR'];
  const finalCurrency = currency && allowedCurrencies.includes(currency) ? currency : 'GBP';
  const allowedStatuses = ['pending', 'confirmed', 'cancelled', 'refunded'];
  const finalStatus = status && allowedStatuses.includes(status) ? status : 'pending';

  const result = await query(
    `INSERT INTO orders (store_id, reference, status, total_cents, currency, customer_name, customer_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, store_id, reference, status, total_cents, currency, customer_name, customer_email, created_at, updated_at`,
    [storeId, reference, finalStatus, total_cents, finalCurrency, customer_name ?? null, customer_email ?? null],
  );
  const updated = result.rows[0]!;
    const body: ApiSuccess<typeof updated> = { ok: true, data: updated };
  res.status(201).json(body);
});

apiRouter.patch('/orders/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = ['pending', 'confirmed', 'cancelled', 'refunded'];
  if (!status || !allowedStatuses.includes(status)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Status must be one of: pending, confirmed, cancelled, refunded.' };
    return res.status(400).json(body);
  }

  const ownershipCheck = await query('SELECT store_id FROM orders WHERE id = $1', [id]);
  if (ownershipCheck.rows.length === 0) {
    const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Order not found.' };
    return res.status(404).json(body);
  }
  if (!checkStoreOwnership(ownershipCheck.rows[0]!.store_id, req.user?.storeId)) {
    return denyResourceAccess(res);
  }

  const result = await query(
    `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, store_id, reference, status, total_cents, currency, customer_name, customer_email, created_at, updated_at`,
    [status, id],
  );
  const updated = result.rows[0]!;
    const body: ApiSuccess<typeof updated> = { ok: true, data: updated };
  res.status(200).json(body);
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
apiRouter.get('/transactions', async (req: Request, res: Response) => {
  const storeId = req.user?.storeId!;
  const result = await query(
    'SELECT id, store_id, order_id, payment_token, status, amount_cents, currency, expires_at, paid_at, created_at, updated_at FROM transactions WHERE store_id = $1 ORDER BY created_at DESC',
    [storeId],
  );
  const body: ApiSuccess<typeof result.rows> = { ok: true, data: result.rows };
  res.status(200).json(body);
});

apiRouter.get('/transactions/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await query(
    'SELECT id, store_id, order_id, payment_token, status, amount_cents, currency, expires_at, paid_at, created_at, updated_at FROM transactions WHERE id = $1',
    [id],
  );
  if (result.rows.length === 0) {
    const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Transaction not found.' };
    return res.status(404).json(body);
  }
  const txn = result.rows[0]!;
  if (!checkStoreOwnership(txn.store_id, req.user?.storeId)) {
    return denyResourceAccess(res);
  }
  const body: ApiSuccess<typeof txn> = { ok: true, data: txn };
  res.status(200).json(body);
});

// ---------------------------------------------------------------------------
// QR Checkout
// ---------------------------------------------------------------------------
apiRouter.post('/checkout/qr', (_req: Request, res: Response) => {
  const body: ApiSuccess<{ message: string }> = {
    ok: true,
    data: { message: 'Generate QR payment request — implementation coming in a later day.' },
  };
  res.status(200).json(body);
});

apiRouter.get('/checkout/:token', (_req: Request, res: Response) => {
  const body: ApiSuccess<{ message: string }> = {
    ok: true,
    data: { message: 'Get payment request status — implementation coming in a later day.' },
  };
  res.status(200).json(body);
});
// Payment confirmation is backend-only and will be triggered via signed webhook — not client POST
// (No client-facing "confirm payment" endpoint to prevent client-side payment status manipulation)

// ---------------------------------------------------------------------------
// AI Assistant (read-only, strictly scoped)
// ---------------------------------------------------------------------------
apiRouter.post('/assistant/query', (_req: Request, res: Response) => {
  const body: ApiSuccess<{ message: string }> = {
    ok: true,
    data: { message: 'AI assistant query — implementation coming in a later day.' },
  };
  res.status(200).json(body);
});
