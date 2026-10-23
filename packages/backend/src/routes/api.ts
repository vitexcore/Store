import { Router, Request, Response, IRouter } from 'express';
import type { ApiSuccess, ApiError, PaginatedData, ProductStatus } from '@store/shared';
import { SUPPORTED_CURRENCIES, MAX_LENGTHS, DEFAULT_CURRENCY } from '@store/shared';
import { isUuid, isNonEmptyString, isNonNegativeInt, isOneOf } from '@store/shared';
import {
  requireAuth, loadUser, requireStore,
  checkStoreOwnership, denyResourceAccess,
} from '../auth/middleware.js';
import { query } from '../db/pool.js';
import { getStore, updateStore } from '../services/storeService.js';
import { listProducts, getProduct, createProduct, updateProduct, archiveProduct, deleteProduct } from '../services/productService.js';
import { getInventorySummary, adjustStock } from '../services/inventoryService.js';
import { getDashboardMetrics } from '../services/dashboardService.js';
import { getSalesAnalytics, AnalyticsValidationError } from '../services/analyticsService.js';

export const apiRouter: IRouter = Router();

// All /api/* routes require authentication + a store association.
apiRouter.use(requireAuth, loadUser, requireStore);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parsePage(raw: unknown): number {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
function parsePageSize(raw: unknown, max = 100): number {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 20;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
apiRouter.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics(req.user!.storeId!);
    const body: ApiSuccess<typeof metrics> = { ok: true, data: metrics };
    res.status(200).json(body);
  } catch (err) {
    console.error('[dashboard] error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to load dashboard metrics.' };
    res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Sales analytics
// ---------------------------------------------------------------------------
// The store is always taken from the authenticated session. A storeId query
// parameter is ignored, so merchants cannot request another store's analytics.
apiRouter.get('/analytics/sales', async (req: Request, res: Response) => {
  try {
    const analytics = await getSalesAnalytics(req.user!.storeId!, {
      preset: req.query['preset'],
      start: req.query['start'],
      end: req.query['end'],
    });
    const body: ApiSuccess<typeof analytics> = { ok: true, data: analytics };
    res.status(200).json(body);
  } catch (err) {
    if (err instanceof AnalyticsValidationError) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: err.message };
      return res.status(400).json(body);
    }
    console.error('[analytics] sales error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to load sales analytics.' };
    res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Store profile
// ---------------------------------------------------------------------------
apiRouter.get('/store', async (req: Request, res: Response) => {
  try {
    const store = await getStore(req.user!.storeId!);
    if (!store) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Store not found.' };
      return res.status(404).json(body);
    }
    const body: ApiSuccess<typeof store> = { ok: true, data: store };
    res.status(200).json(body);
  } catch (err) {
    console.error('[store] get error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to load store.' };
    res.status(500).json(body);
  }
});

apiRouter.patch('/store', async (req: Request, res: Response) => {
  const { name, description, contactEmail, address, defaultCurrency } = req.body;
  const storeId = req.user!.storeId!;

  // Validate each provided field
  if (name !== undefined) {
    if (!isNonEmptyString(name, MAX_LENGTHS.storeName)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Store name must be 1–${MAX_LENGTHS.storeName} characters.` };
      return res.status(400).json(body);
    }
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string' || description.length > MAX_LENGTHS.storeDescription) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Description must be at most ${MAX_LENGTHS.storeDescription} characters.` };
      return res.status(400).json(body);
    }
  }
  if (contactEmail !== undefined && contactEmail !== null) {
    if (typeof contactEmail !== 'string' || contactEmail.length > 254) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Contact email must be at most 254 characters.' };
      return res.status(400).json(body);
    }
  }
  if (address !== undefined && address !== null) {
    if (typeof address !== 'string' || address.length > MAX_LENGTHS.storeAddress) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Address must be at most ${MAX_LENGTHS.storeAddress} characters.` };
      return res.status(400).json(body);
    }
  }
  if (defaultCurrency !== undefined) {
    if (!isOneOf(defaultCurrency, SUPPORTED_CURRENCIES)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}.` };
      return res.status(400).json(body);
    }
  }

  try {
    const updated = await updateStore(storeId, { name, description, contactEmail, address, defaultCurrency });
    if (!updated) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Store not found.' };
      return res.status(404).json(body);
    }
    const body: ApiSuccess<typeof updated> = { ok: true, data: updated };
    res.status(200).json(body);
  } catch (err) {
    console.error('[store] patch error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to update store.' };
    res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const ALLOWED_STATUSES: ProductStatus[] = ['active', 'draft', 'archived'];
const ALLOWED_CURRENCIES = [...SUPPORTED_CURRENCIES] as string[];

apiRouter.get('/products', async (req: Request, res: Response) => {
  const storeId = req.user!.storeId!;
  try {
    const page = parsePage(req.query['page']);
    const pageSize = parsePageSize(req.query['pageSize']);
    const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
    const statusQ = req.query['status'];
    const status = (isOneOf(statusQ, [...ALLOWED_STATUSES, 'all'] as const) ? statusQ : 'all') as ProductStatus | 'all';

    const result = await listProducts({ storeId, page, pageSize, ...(search !== undefined ? { search } : {}), status });
    const body: ApiSuccess<PaginatedData<typeof result.items[0]>> = { ok: true, data: result };
    res.status(200).json(body);
  } catch (err) {
    console.error('[products] list error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to list products.' };
    res.status(500).json(body);
  }
});

apiRouter.post('/products', async (req: Request, res: Response) => {
  const storeId = req.user!.storeId!;
  const { name, description, price_cents, currency, status, image_url, stock_quantity, low_stock_threshold, idempotency_key } = req.body;

  if (!isNonEmptyString(name, MAX_LENGTHS.productName)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Product name is required (max ${MAX_LENGTHS.productName} chars).` };
    return res.status(400).json(body);
  }
  if (!isNonNegativeInt(price_cents)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'price_cents must be a non-negative integer.' };
    return res.status(400).json(body);
  }
  if (idempotency_key !== undefined && !isUuid(idempotency_key)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'idempotency_key must be a valid UUID.' };
    return res.status(400).json(body);
  }
  if (currency !== undefined && !ALLOWED_CURRENCIES.includes(currency)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}.` };
    return res.status(400).json(body);
  }
  if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Status must be active, draft, or archived.' };
    return res.status(400).json(body);
  }
  if (stock_quantity !== undefined && !isNonNegativeInt(stock_quantity)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'stock_quantity must be a non-negative integer.' };
    return res.status(400).json(body);
  }
  if (low_stock_threshold !== undefined && !isNonNegativeInt(low_stock_threshold)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'low_stock_threshold must be a non-negative integer.' };
    return res.status(400).json(body);
  }

  try {
    const result = await createProduct({
      storeId,
      idempotencyKey: idempotency_key,
      name,
      description,
      priceCents: price_cents,
      currency,
      status,
      imageUrl: image_url ?? null,
      stockQuantity: stock_quantity,
      lowStockThreshold: low_stock_threshold,
    });
    const body: ApiSuccess<typeof result.product> = { ok: true, data: result.product };
    res.status(result.created ? 201 : 200).json(body);
  } catch (err) {
    console.error('[products] create error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to create product.' };
    res.status(500).json(body);
  }
});

apiRouter.get('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid product ID.' };
    return res.status(400).json(body);
  }
  try {
    const product = await getProduct(id);
    if (!product) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      return res.status(404).json(body);
    }
    if (!checkStoreOwnership(product.storeId, req.user?.storeId)) {
      return denyResourceAccess(res);
    }
    const body: ApiSuccess<typeof product> = { ok: true, data: product };
    res.status(200).json(body);
  } catch (err) {
    console.error('[products] get error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to get product.' };
    res.status(500).json(body);
  }
});

apiRouter.patch('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid product ID.' };
    return res.status(400).json(body);
  }

  // Ownership check
  try {
    const existing = await getProduct(id);
    if (!existing) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      return res.status(404).json(body);
    }
    if (!checkStoreOwnership(existing.storeId, req.user?.storeId)) {
      return denyResourceAccess(res);
    }

    const { name, description, price_cents, currency, status, image_url, low_stock_threshold } = req.body;

    if (name !== undefined && !isNonEmptyString(name, MAX_LENGTHS.productName)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Product name must be 1–${MAX_LENGTHS.productName} characters.` };
      return res.status(400).json(body);
    }
    if (price_cents !== undefined && !isNonNegativeInt(price_cents)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'price_cents must be a non-negative integer.' };
      return res.status(400).json(body);
    }
    if (currency !== undefined && !ALLOWED_CURRENCIES.includes(currency)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}.` };
      return res.status(400).json(body);
    }
    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Status must be active, draft, or archived.' };
      return res.status(400).json(body);
    }
    if (low_stock_threshold !== undefined && !isNonNegativeInt(low_stock_threshold)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'low_stock_threshold must be a non-negative integer.' };
      return res.status(400).json(body);
    }

    const updated = await updateProduct(id, {
      name,
      description,
      priceCents: price_cents,
      currency,
      status,
      imageUrl: image_url,
      lowStockThreshold: low_stock_threshold,
    });
    const body: ApiSuccess<typeof updated> = { ok: true, data: updated };
    res.status(200).json(body);
  } catch (err) {
    console.error('[products] patch error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to update product.' };
    res.status(500).json(body);
  }
});

apiRouter.patch('/products/:id/archive', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid product ID.' };
    return res.status(400).json(body);
  }
  try {
    const existing = await getProduct(id);
    if (!existing) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      return res.status(404).json(body);
    }
    if (!checkStoreOwnership(existing.storeId, req.user?.storeId)) {
      return denyResourceAccess(res);
    }
    const archived = await archiveProduct(id);
    const body: ApiSuccess<typeof archived> = { ok: true, data: archived };
    res.status(200).json(body);
  } catch (err) {
    console.error('[products] archive error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to archive product.' };
    res.status(500).json(body);
  }
});

// Keep legacy PUT for backward compat with existing tests
apiRouter.put('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid product ID.' };
    return res.status(400).json(body);
  }
  try {
    const existing = await getProduct(id);
    if (!existing) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      return res.status(404).json(body);
    }
    if (!checkStoreOwnership(existing.storeId, req.user?.storeId)) {
      return denyResourceAccess(res);
    }
    const { name, description, price_cents, currency, status, image_url, low_stock_threshold } = req.body;
    if (name !== undefined && !isNonEmptyString(name, MAX_LENGTHS.productName)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Product name must be 1–${MAX_LENGTHS.productName} characters.` };
      return res.status(400).json(body);
    }
    if (price_cents !== undefined && !isNonNegativeInt(price_cents)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'price_cents must be a non-negative integer.' };
      return res.status(400).json(body);
    }
    if (currency !== undefined && !ALLOWED_CURRENCIES.includes(currency)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}.` };
      return res.status(400).json(body);
    }
    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Status must be active, draft, or archived.' };
      return res.status(400).json(body);
    }
    const updated = await updateProduct(id, { name, description, priceCents: price_cents, currency, status, imageUrl: image_url, lowStockThreshold: low_stock_threshold });
    const body: ApiSuccess<typeof updated> = { ok: true, data: updated };
    res.status(200).json(body);
  } catch (err) {
    console.error('[products] put error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to update product.' };
    res.status(500).json(body);
  }
});

apiRouter.delete('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid product ID.' };
    return res.status(400).json(body);
  }
  try {
    const existing = await getProduct(id);
    if (!existing) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      return res.status(404).json(body);
    }
    if (!checkStoreOwnership(existing.storeId, req.user?.storeId)) {
      return denyResourceAccess(res);
    }

    const result = await deleteProduct(id, req.user!.storeId!);
    if (result === 'not_found') {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      return res.status(404).json(body);
    }
    if (result === 'has_inventory_records') {
      const body: ApiError = {
        ok: false,
        code: 'PRODUCT_HAS_INVENTORY_RECORDS',
        message: 'This product has stock or inventory history and cannot be permanently deleted. Archive it instead.',
      };
      return res.status(409).json(body);
    }
    const body: ApiSuccess<null> = { ok: true, data: null };
    res.status(200).json(body);
  } catch (err) {
    console.error('[products] delete error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to delete product.' };
    res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
apiRouter.get('/inventory', async (req: Request, res: Response) => {
  const storeId = req.user!.storeId!;
  try {
    const page = parsePage(req.query['page']);
    const pageSize = parsePageSize(req.query['pageSize']);
    const result = await getInventorySummary(storeId, { page, pageSize });
    const body: ApiSuccess<typeof result> = { ok: true, data: result };
    res.status(200).json(body);
  } catch (err) {
    console.error('[inventory] summary error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to load inventory.' };
    res.status(500).json(body);
  }
});

apiRouter.post('/inventory/:productId/adjust', async (req: Request, res: Response) => {
  const { productId } = req.params;
  if (!isUuid(productId)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid product ID.' };
    return res.status(400).json(body);
  }

  const { delta, reason } = req.body;

  if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'delta must be a non-zero integer.' };
    return res.status(400).json(body);
  }
  if (reason !== undefined && typeof reason !== 'string') {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'reason must be a string.' };
    return res.status(400).json(body);
  }

  const storeId = req.user!.storeId!;
  const userId = req.user!.id;

  // Ownership check before locking
  try {
    const existing = await getProduct(productId);
    if (!existing) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
      return res.status(404).json(body);
    }
    if (!checkStoreOwnership(existing.storeId, storeId)) {
      return denyResourceAccess(res);
    }

    const result = await adjustStock({
      storeId,
      productId,
      userId,
      delta,
      reason: reason ?? '',
    });

    const body: ApiSuccess<typeof result> = { ok: true, data: result };
    res.status(200).json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'INSUFFICIENT_STOCK') {
      const body: ApiError = { ok: false, code: 'INSUFFICIENT_STOCK', message: 'Adjustment would result in negative stock.' };
      return res.status(422).json(body);
    }
    console.error('[inventory] adjust error:', msg);
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to adjust stock.' };
    res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Orders (paginated)
// ---------------------------------------------------------------------------
apiRouter.get('/orders', async (req: Request, res: Response) => {
  const storeId = req.user!.storeId!;
  try {
    const page = parsePage(req.query['page']);
    const pageSize = parsePageSize(req.query['pageSize']);
    const offset = (page - 1) * pageSize;

    const countResult = await query<{ total: string }>(
      'SELECT COUNT(*) AS total FROM orders WHERE store_id = $1',
      [storeId],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const result = await query(
      `SELECT id, store_id, reference, status, total_cents, currency,
              customer_name, customer_email, created_at, updated_at
       FROM orders WHERE store_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [storeId, pageSize, offset],
    );

    const body: ApiSuccess<{ items: typeof result.rows; meta: object }> = {
      ok: true,
      data: {
        items: result.rows,
        meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    };
    res.status(200).json(body);
  } catch (err) {
    console.error('[orders] list error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to list orders.' };
    res.status(500).json(body);
  }
});

apiRouter.get('/orders/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid order ID.' };
    return res.status(400).json(body);
  }
  try {
    const result = await query(
      `SELECT id, store_id, reference, status, total_cents, currency,
              customer_name, customer_email, created_at, updated_at
       FROM orders WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Order not found.' };
      return res.status(404).json(body);
    }
    const order = result.rows[0]!;
    if (!checkStoreOwnership(order.store_id, req.user?.storeId)) return denyResourceAccess(res);
    const body: ApiSuccess<typeof order> = { ok: true, data: order };
    res.status(200).json(body);
  } catch (err) {
    console.error('[orders] get error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to get order.' };
    res.status(500).json(body);
  }
});

apiRouter.post('/orders', async (req: Request, res: Response) => {
  const storeId = req.user!.storeId!;
  const { reference, total_cents, currency, customer_name, customer_email, status } = req.body;

  if (!isNonEmptyString(reference, MAX_LENGTHS.orderReference)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: `Order reference is required (1–${MAX_LENGTHS.orderReference} chars).` };
    return res.status(400).json(body);
  }
  if (!isNonNegativeInt(total_cents)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'total_cents must be a non-negative integer.' };
    return res.status(400).json(body);
  }

  const finalCurrency = isOneOf(currency, SUPPORTED_CURRENCIES) ? currency : DEFAULT_CURRENCY;
  const allowedOrderStatuses = ['pending', 'confirmed', 'cancelled', 'refunded'] as const;
  const finalStatus = isOneOf(status, allowedOrderStatuses) ? status : 'pending';

  try {
    const result = await query(
      `INSERT INTO orders (store_id, reference, status, total_cents, currency, customer_name, customer_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, store_id, reference, status, total_cents, currency, customer_name, customer_email, created_at, updated_at`,
      [storeId, reference, finalStatus, total_cents, finalCurrency, customer_name ?? null, customer_email ?? null],
    );
    const body: ApiSuccess<(typeof result.rows)[0]> = { ok: true, data: result.rows[0]! };
    res.status(201).json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate key') && msg.includes('reference')) {
      const body: ApiError = { ok: false, code: 'CONFLICT', message: 'Order reference already exists.' };
      return res.status(409).json(body);
    }
    console.error('[orders] create error:', msg);
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to create order.' };
    res.status(500).json(body);
  }
});

apiRouter.patch('/orders/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedOrderStatuses = ['pending', 'confirmed', 'cancelled', 'refunded'] as const;

  if (!isOneOf(status, allowedOrderStatuses)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Status must be one of: pending, confirmed, cancelled, refunded.' };
    return res.status(400).json(body);
  }
  try {
    const ownerCheck = await query('SELECT store_id FROM orders WHERE id = $1', [id]);
    if (ownerCheck.rows.length === 0) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Order not found.' };
      return res.status(404).json(body);
    }
    if (!checkStoreOwnership(ownerCheck.rows[0]!.store_id, req.user?.storeId)) return denyResourceAccess(res);

    const result = await query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, store_id, reference, status, total_cents, currency, customer_name, customer_email, created_at, updated_at`,
      [status, id],
    );
    const body: ApiSuccess<(typeof result.rows)[0]> = { ok: true, data: result.rows[0]! };
    res.status(200).json(body);
  } catch (err) {
    console.error('[orders] status error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to update order status.' };
    res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Transactions (paginated, read-only)
// ---------------------------------------------------------------------------
apiRouter.get('/transactions', async (req: Request, res: Response) => {
  const storeId = req.user!.storeId!;
  try {
    const page = parsePage(req.query['page']);
    const pageSize = parsePageSize(req.query['pageSize']);
    const offset = (page - 1) * pageSize;

    const countResult = await query<{ total: string }>(
      'SELECT COUNT(*) AS total FROM transactions WHERE store_id = $1',
      [storeId],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const result = await query(
      `SELECT t.id, t.store_id, t.order_id, o.reference AS order_reference,
              t.status, t.amount_cents, t.currency, t.expires_at, t.paid_at,
              t.created_at, t.updated_at
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       WHERE t.store_id = $1
       ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
      [storeId, pageSize, offset],
    );

    const body: ApiSuccess<{ items: typeof result.rows; meta: object }> = {
      ok: true,
      data: {
        items: result.rows,
        meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    };
    res.status(200).json(body);
  } catch (err) {
    console.error('[transactions] list error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to list transactions.' };
    res.status(500).json(body);
  }
});

apiRouter.get('/transactions/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid transaction ID.' };
    return res.status(400).json(body);
  }
  try {
    const result = await query(
      `SELECT t.id, t.store_id, t.order_id, o.reference AS order_reference,
              t.status, t.amount_cents, t.currency, t.expires_at, t.paid_at, t.created_at
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       WHERE t.id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Transaction not found.' };
      return res.status(404).json(body);
    }
    const txn = result.rows[0]!;
    if (!checkStoreOwnership(txn.store_id, req.user?.storeId)) return denyResourceAccess(res);
    const body: ApiSuccess<typeof txn> = { ok: true, data: txn };
    res.status(200).json(body);
  } catch (err) {
    console.error('[transactions] get error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to get transaction.' };
    res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// AI Assistant (stub — read-only, implemented in later stage)
// ---------------------------------------------------------------------------
apiRouter.post('/assistant/query', (_req: Request, res: Response) => {
  const body: ApiSuccess<{ message: string }> = {
    ok: true,
    data: { message: 'AI assistant query — implementation coming in a later day.' },
  };
  res.status(200).json(body);
});
