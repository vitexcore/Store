/**
 * Inventory service — stock summary and stock adjustments.
 *
 * Concurrency safety: adjustStock uses SELECT ... FOR UPDATE inside a
 * transaction so concurrent adjustments serialize on the product row
 * and don't silently lose updates.
 */

import { query, getClient } from '../db/pool.js';
import type { Product, InventoryAdjustment, PaginatedData } from '@store/shared';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@store/shared';

// ---------------------------------------------------------------------------
// Inventory summary row
// ---------------------------------------------------------------------------
interface ProductStockRow {
  id: string;
  store_id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  status: import('@store/shared').ProductStatus;
  image_url: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  created_at: Date;
  updated_at: Date;
}

interface AdjustmentRow {
  id: string;
  store_id: string;
  product_id: string;
  user_id: string;
  delta: number;
  reason: string;
  created_at: Date;
}

function rowToProduct(row: ProductStockRow): Product {
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

function rowToAdjustment(row: AdjustmentRow): InventoryAdjustment {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    userId: row.user_id,
    delta: row.delta,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}

const PRODUCT_COLUMNS = `
  id, store_id, name, description, price_cents, currency, status, image_url,
  stock_quantity, low_stock_threshold, created_at, updated_at`;

// ---------------------------------------------------------------------------
// Inventory summary — all non-archived products for a store with stock info
// ---------------------------------------------------------------------------
export async function getInventorySummary(
  storeId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<PaginatedData<Product>> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE)));
  const offset = (page - 1) * pageSize;

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM products WHERE store_id = $1 AND status <> 'archived'`,
    [storeId],
  );
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const result = await query<ProductStockRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products
     WHERE store_id = $1 AND status <> 'archived'
     ORDER BY stock_quantity ASC, name ASC
     LIMIT $2 OFFSET $3`,
    [storeId, pageSize, offset],
  );

  return {
    items: result.rows.map(rowToProduct),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

// ---------------------------------------------------------------------------
// Adjust stock — uses row-level lock to prevent lost updates
// ---------------------------------------------------------------------------
export interface AdjustStockInput {
  storeId: string;
  productId: string;
  userId: string;
  delta: number;        // positive = add, negative = remove
  reason: string;
  allowNegative?: boolean;
}

export interface AdjustStockResult {
  product: Product;
  adjustment: InventoryAdjustment;
}

export async function adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the product row so concurrent requests serialize here
    const lockResult = await client.query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [input.productId, input.storeId],
    );

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('PRODUCT_NOT_FOUND');
    }

    const current = lockResult.rows[0]!;
    const newQty = current.stock_quantity + input.delta;

    if (!input.allowNegative && newQty < 0) {
      await client.query('ROLLBACK');
      throw new Error('INSUFFICIENT_STOCK');
    }

    // Apply the adjustment
    const updatedResult = await client.query<ProductStockRow>(
      `UPDATE products
       SET stock_quantity = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING ${PRODUCT_COLUMNS}`,
      [Math.max(0, newQty), input.productId],
    );

    // Record the adjustment audit log entry
    const adjResult = await client.query<AdjustmentRow>(
      `INSERT INTO inventory_adjustments (store_id, product_id, user_id, delta, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, store_id, product_id, user_id, delta, reason, created_at`,
      [input.storeId, input.productId, input.userId, input.delta, input.reason.trim().slice(0, 500)],
    );

    await client.query('COMMIT');

    return {
      product: rowToProduct(updatedResult.rows[0]!),
      adjustment: rowToAdjustment(adjResult.rows[0]!),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
