/**
 * Product service — CRUD + archive + paginated list with search/filter.
 * All queries are store-scoped and parameterized.
 */

import { getClient, query } from '../db/pool.js';
import type { Product, ProductStatus, PaginatedData } from '@store/shared';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@store/shared';

// ---------------------------------------------------------------------------
// Row shape (snake_case from DB)
// ---------------------------------------------------------------------------
interface ProductRow {
  id: string;
  store_id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  status: ProductStatus;
  image_url: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  created_at: Date;
  updated_at: Date;
}

function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    currency: row.currency,
    status: row.status,
    imageUrl: row.image_url,
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const PRODUCT_COLUMNS = `
  id, store_id, name, description, price_cents, currency, status, image_url,
  stock_quantity, low_stock_threshold, created_at, updated_at`;

// ---------------------------------------------------------------------------
// List with pagination + search + status filter
// ---------------------------------------------------------------------------
export interface ListProductsInput {
  storeId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ProductStatus | 'all';
}

export async function listProducts(input: ListProductsInput): Promise<PaginatedData<Product>> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['store_id = $1'];
  const params: unknown[] = [input.storeId];
  let idx = 2;

  if (input.search && input.search.trim().length > 0) {
    const term = `%${input.search.trim().toLowerCase()}%`;
    conditions.push(`(LOWER(name) LIKE $${idx} OR LOWER(description) LIKE $${idx})`);
    params.push(term);
    idx++;
  }

  if (input.status && input.status !== 'all') {
    conditions.push(`status = $${idx++}`);
    params.push(input.status);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM products ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const dataResult = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products ${where}
     ORDER BY created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset],
  );

  return {
    items: dataResult.rows.map(rowToProduct),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ---------------------------------------------------------------------------
// Get single product (ownership checked at route level)
// ---------------------------------------------------------------------------
export async function getProduct(productId: string): Promise<Product | null> {
  const result = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`,
    [productId],
  );
  return result.rows[0] ? rowToProduct(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export interface CreateProductInput {
  storeId: string;
  idempotencyKey?: string;
  name: string;
  description?: string;
  priceCents: number;
  currency?: string;
  status?: ProductStatus;
  imageUrl?: string | null;
  stockQuantity?: number;
  lowStockThreshold?: number;
}

export interface CreateProductResult {
  product: Product;
  created: boolean;
}

export async function createProduct(input: CreateProductInput): Promise<CreateProductResult> {
  const values = [
    input.storeId,
    input.name.trim(),
    (input.description ?? '').trim().slice(0, 2000),
    input.priceCents,
    input.currency ?? 'NGN',
    input.status ?? 'draft',
    input.imageUrl ?? null,
    input.stockQuantity ?? 0,
    input.lowStockThreshold ?? 5,
  ];

  if (input.idempotencyKey) {
    const result = await query<ProductRow>(
      `INSERT INTO products
         (store_id, name, description, price_cents, currency, status, image_url, stock_quantity, low_stock_threshold, create_idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (store_id, create_idempotency_key) WHERE create_idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${PRODUCT_COLUMNS}`,
      [...values, input.idempotencyKey],
    );
    if (result.rows[0]) return { product: rowToProduct(result.rows[0]), created: true };

    // A retry with the same key returns the original product instead of inserting a duplicate.
    const existing = await query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE store_id = $1 AND create_idempotency_key = $2`,
      [input.storeId, input.idempotencyKey],
    );
    if (existing.rows[0]) return { product: rowToProduct(existing.rows[0]), created: false };
    throw new Error('Product idempotency record could not be loaded after conflict.');
  }

  const result = await query<ProductRow>(
    `INSERT INTO products
       (store_id, name, description, price_cents, currency, status, image_url, stock_quantity, low_stock_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${PRODUCT_COLUMNS}`,
    values,
  );
  return { product: rowToProduct(result.rows[0]!), created: true };
}

// ---------------------------------------------------------------------------
// Update (partial)
// ---------------------------------------------------------------------------
export interface UpdateProductInput {
  name?: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  status?: ProductStatus;
  imageUrl?: string | null;
  lowStockThreshold?: number;
}

export async function updateProduct(productId: string, input: UpdateProductInput): Promise<Product | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) { updates.push(`name = $${idx++}`); params.push(input.name.trim()); }
  if (input.description !== undefined) { updates.push(`description = $${idx++}`); params.push(input.description.trim().slice(0, 2000)); }
  if (input.priceCents !== undefined) { updates.push(`price_cents = $${idx++}`); params.push(input.priceCents); }
  if (input.currency !== undefined) { updates.push(`currency = $${idx++}`); params.push(input.currency); }
  if (input.status !== undefined) { updates.push(`status = $${idx++}`); params.push(input.status); }
  if (input.imageUrl !== undefined) { updates.push(`image_url = $${idx++}`); params.push(input.imageUrl); }
  if (input.lowStockThreshold !== undefined) { updates.push(`low_stock_threshold = $${idx++}`); params.push(input.lowStockThreshold); }

  if (updates.length === 0) return getProduct(productId);

  updates.push(`updated_at = NOW()`);
  params.push(productId);

  const result = await query<ProductRow>(
    `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${PRODUCT_COLUMNS}`,
    params,
  );
  return result.rows[0] ? rowToProduct(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Archive (sets status = 'archived')
// ---------------------------------------------------------------------------
export async function archiveProduct(productId: string): Promise<Product | null> {
  const result = await query<ProductRow>(
    `UPDATE products SET status = 'archived', updated_at = NOW()
     WHERE id = $1 AND status <> 'archived'
     RETURNING ${PRODUCT_COLUMNS}`,
    [productId],
  );
  if (result.rows[0]) return rowToProduct(result.rows[0]);
  // Already archived or not found — return current state
  return getProduct(productId);
}

// ---------------------------------------------------------------------------
// Permanently delete a product only when inventory history can be preserved
// ---------------------------------------------------------------------------
export type DeleteProductResult = 'deleted' | 'not_found' | 'has_inventory_records';

export async function deleteProduct(productId: string, storeId: string): Promise<DeleteProductResult> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Serialize deletion with inventory adjustments, which lock this same row.
    const product = await client.query<{ id: string; stock_quantity: number }>(
      'SELECT id, stock_quantity FROM products WHERE id = $1 AND store_id = $2 FOR UPDATE',
      [productId, storeId],
    );
    if (product.rowCount === 0) {
      await client.query('COMMIT');
      return 'not_found';
    }

    const history = await client.query<{ has_history: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM inventory_adjustments WHERE product_id = $1) AS has_history',
      [productId],
    );
    if ((product.rows[0]?.stock_quantity ?? 0) > 0 || history.rows[0]?.has_history) {
      await client.query('COMMIT');
      return 'has_inventory_records';
    }

    await client.query('DELETE FROM products WHERE id = $1 AND store_id = $2', [productId, storeId]);
    await client.query('COMMIT');
    return 'deleted';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
