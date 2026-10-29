/**
 * Inventory service — stock summary and stock adjustments.
 *
 * Concurrency safety: adjustStock uses SELECT ... FOR UPDATE inside a
 * transaction so concurrent adjustments serialize on the product row
 * and don't silently lose updates.
 */

import { query, getClient } from '../db/pool.js';
import { config } from '../config.js';
import type {
  Product,
  InventoryAdjustment,
  PaginatedData,
  InventoryAnalytics,
  ProductStockItem,
  InventoryUnavailableItem,
  InventoryAttentionItem,
  ProductStatus,
  InventoryAlert,
  InventoryAlerts,
  InventoryAlertType,
  InventoryAlertSeverity,
  RestockRecommendation,
  RestockRecommendations,
} from '@store/shared';
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

// ---------------------------------------------------------------------------
// Inventory Analytics & Intelligence
// Deterministic aggregated data and lists for the AI business assistant.
// Scoped exclusively to the authenticated store.
// ---------------------------------------------------------------------------

export interface InventoryAnalyticsOptions {
  question?: string;
}

export async function getInventoryAnalytics(
  storeId: string,
  options: InventoryAnalyticsOptions = {},
): Promise<InventoryAnalytics> {
  // 1. Aggregated counts in a single query
  const countsResult = await query<{
    total_products: string;
    available_products: string;
    low_stock_products: string;
    out_of_stock_products: string;
    unavailable_products: string;
    inactive_products: string;
    active_products: string;
    draft_products: string;
    archived_products: string;
    total_stock_units: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_products,
       COUNT(CASE WHEN status = 'active' AND stock_quantity > 0 THEN 1 END)::text AS available_products,
       COUNT(CASE WHEN stock_quantity > 0 AND stock_quantity <= low_stock_threshold THEN 1 END)::text AS low_stock_products,
       COUNT(CASE WHEN stock_quantity = 0 THEN 1 END)::text AS out_of_stock_products,
       COUNT(CASE WHEN status <> 'active' OR stock_quantity = 0 THEN 1 END)::text AS unavailable_products,
       COUNT(CASE WHEN status <> 'active' THEN 1 END)::text AS inactive_products,
       COUNT(CASE WHEN status = 'active' THEN 1 END)::text AS active_products,
       COUNT(CASE WHEN status = 'draft' THEN 1 END)::text AS draft_products,
       COUNT(CASE WHEN status = 'archived' THEN 1 END)::text AS archived_products,
       COALESCE(SUM(stock_quantity), 0)::text AS total_stock_units
     FROM products
     WHERE store_id = $1`,
    [storeId],
  );

  const row = countsResult.rows[0];
  const totalProducts = parseInt(row?.total_products ?? '0', 10);
  const availableProductsCount = parseInt(row?.available_products ?? '0', 10);
  const lowStockProductsCount = parseInt(row?.low_stock_products ?? '0', 10);
  const outOfStockProductsCount = parseInt(row?.out_of_stock_products ?? '0', 10);
  const unavailableProductsCount = parseInt(row?.unavailable_products ?? '0', 10);
  const inactiveProductsCount = parseInt(row?.inactive_products ?? '0', 10);
  const activeProductsCount = parseInt(row?.active_products ?? '0', 10);
  const draftProductsCount = parseInt(row?.draft_products ?? '0', 10);
  const archivedProductsCount = parseInt(row?.archived_products ?? '0', 10);
  const totalStockUnits = parseInt(row?.total_stock_units ?? '0', 10);

  // Helper to convert DB row to ProductStockItem
  const mapItem = (r: ProductStockRow): ProductStockItem => ({
    id: r.id,
    name: r.name,
    stockQuantity: r.stock_quantity,
    lowStockThreshold: r.low_stock_threshold,
    status: r.status,
    priceCents: r.price_cents,
    currency: r.currency,
  });

  // 2. Fetch specific lists in parallel
  const [
    lowStockResult,
    outOfStockResult,
    unavailableResult,
    inactiveResult,
    lowestStockResult,
    attentionResult,
  ] = await Promise.all([
    // Low stock: stock > 0 AND stock <= threshold
    query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1 AND stock_quantity > 0 AND stock_quantity <= low_stock_threshold
       ORDER BY stock_quantity ASC, name ASC
       LIMIT 50`,
      [storeId],
    ),
    // Out of stock: stock = 0
    query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1 AND stock_quantity = 0
       ORDER BY name ASC
       LIMIT 50`,
      [storeId],
    ),
    // Unavailable: status <> 'active' OR stock = 0
    query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1 AND (status <> 'active' OR stock_quantity = 0)
       ORDER BY name ASC
       LIMIT 50`,
      [storeId],
    ),
    // Inactive: status <> 'active'
    query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1 AND status <> 'active'
       ORDER BY name ASC
       LIMIT 50`,
      [storeId],
    ),
    // Lowest stock: ordered by stock_quantity ASC
    query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1
       ORDER BY stock_quantity ASC, name ASC
       LIMIT 10`,
      [storeId],
    ),
    // Attention needed: stock = 0 OR (stock > 0 AND stock <= threshold)
    query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1 AND (stock_quantity = 0 OR (stock_quantity > 0 AND stock_quantity <= low_stock_threshold))
       ORDER BY stock_quantity ASC, name ASC
       LIMIT 50`,
      [storeId],
    ),
  ]);

  const lowStockProducts = lowStockResult.rows.map(mapItem);
  const outOfStockProducts = outOfStockResult.rows.map(mapItem);

  const unavailableProducts: InventoryUnavailableItem[] = unavailableResult.rows.map((r) => {
    let reason: 'out_of_stock' | 'inactive' | 'inactive_and_out_of_stock';
    if (r.status !== 'active' && r.stock_quantity === 0) {
      reason = 'inactive_and_out_of_stock';
    } else if (r.status !== 'active') {
      reason = 'inactive';
    } else {
      reason = 'out_of_stock';
    }
    return { ...mapItem(r), reason };
  });

  const inactiveProducts = inactiveResult.rows.map(mapItem);
  const lowestStockProducts = lowestStockResult.rows.map(mapItem);

  const attentionNeededProducts: InventoryAttentionItem[] = attentionResult.rows.map((r) => ({
    ...mapItem(r),
    issue: r.stock_quantity === 0 ? 'out_of_stock' : 'low_stock',
  }));

  // 3. If catalogue is small (<= 100 products), load all products for full context
  let allProducts: ProductStockItem[] | undefined;
  if (totalProducts <= 100) {
    const allResult = await query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1
       ORDER BY name ASC
       LIMIT 100`,
      [storeId],
    );
    allProducts = allResult.rows.map(mapItem);
  }

  // 4. Product matching from question (for "Show me current stock quantity of X")
  let matchedProducts: ProductStockItem[] | undefined;
  if (options.question && options.question.trim().length > 0) {
    const qClean = options.question.trim().replace(/[?!.,;:'"()]/g, ' ');

    // First: Check if the question contains the full name of any product
    const fullNameMatches = await query<ProductStockRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE store_id = $1 AND $2 ILIKE '%' || name || '%'
       ORDER BY char_length(name) DESC, name ASC
       LIMIT 10`,
      [storeId, qClean],
    );

    if (fullNameMatches.rows.length > 0) {
      matchedProducts = fullNameMatches.rows.map(mapItem);
    } else {
      // Second: Fall back to significant keywords (>= 3 chars, ignoring common stopwords)
      const stopwords = new Set([
        'what', 'how', 'many', 'much', 'the', 'for', 'and', 'are', 'is', 'which',
        'show', 'tell', 'give', 'product', 'products', 'item', 'items', 'stock',
        'quantity', 'level', 'levels', 'current', 'have', 'store', 'available',
        'running', 'finished', 'about', 'some', 'any', 'lowest', 'highest',
        'inventory', 'attention', 'need', 'out', 'low',
      ]);
      const words = qClean
        .split(/\s+/)
        .map((w) => w.toLowerCase())
        .filter((w) => w.length >= 3 && !stopwords.has(w));

      if (words.length > 0) {
        const keywordPatterns = words.map((w) => `%${w}%`);
        const keywordMatches = await query<ProductStockRow>(
          `SELECT ${PRODUCT_COLUMNS} FROM products
           WHERE store_id = $1 AND name ILIKE ANY($2)
           ORDER BY name ASC
           LIMIT 10`,
          [storeId, keywordPatterns],
        );
        matchedProducts = keywordMatches.rows.map(mapItem);
      } else {
        matchedProducts = [];
      }
    }
  }

  return {
    totalProducts,
    availableProductsCount,
    lowStockProductsCount,
    outOfStockProductsCount,
    unavailableProductsCount,
    inactiveProductsCount,
    totalStockUnits,
    statusBreakdown: {
      active: activeProductsCount,
      draft: draftProductsCount,
      archived: archivedProductsCount,
    },
    lowStockProducts,
    outOfStockProducts,
    unavailableProducts,
    inactiveProducts,
    lowestStockProducts,
    attentionNeededProducts,
    ...(matchedProducts !== undefined ? { matchedProducts } : {}),
    ...(allProducts !== undefined ? { allProducts } : {}),
  };
}

// ---------------------------------------------------------------------------
// Inventory alerts — computed dynamically from current product state.
//
// Design choice: alerts are NOT persisted. Each request re-derives the alert
// set from the products table, so:
//   * The same condition can never produce duplicate alert rows.
//   * Alerts always reflect the latest trusted inventory state — an alert
//     "resolves" automatically once stock changes (no stale resolution state).
//   * No new table, migration, or background reconciliation is required.
//   * Performance is adequate because the query is store-scoped, uses the
//     idx_inventory_alerts_store_stock_status index, and is bounded by LIMIT.
// ---------------------------------------------------------------------------

export interface GetInventoryAlertsOptions {
  limit?: number;
}

export async function getInventoryAlerts(
  storeId: string,
  options: GetInventoryAlertsOptions = {},
): Promise<InventoryAlerts> {
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)));

  const [result, countResult] = await Promise.all([
    query<{
    id: string;
    name: string;
    stock_quantity: number;
    low_stock_threshold: number;
    status: ProductStatus;
    updated_at: Date;
    }>(
    `SELECT id, name, stock_quantity, low_stock_threshold, status, updated_at
     FROM products
     WHERE store_id = $1
       AND (stock_quantity = 0 OR stock_quantity <= low_stock_threshold OR status <> 'active')
     ORDER BY stock_quantity ASC, name ASC
     LIMIT $2`,
    [storeId, limit],
    ),
    query<{
      out_of_stock: string;
      low_stock: string;
      inactive: string;
      critical: string;
      total: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE stock_quantity = 0)::text AS out_of_stock,
         COUNT(*) FILTER (WHERE stock_quantity > 0 AND stock_quantity <= low_stock_threshold)::text AS low_stock,
         COUNT(*) FILTER (WHERE status <> 'active' AND stock_quantity > 0 AND stock_quantity > low_stock_threshold)::text AS inactive,
         COUNT(*) FILTER (WHERE stock_quantity = 0 OR (stock_quantity > 0 AND stock_quantity <= GREATEST(1, FLOOR(low_stock_threshold / 2.0))))::text AS critical,
         COUNT(*) FILTER (WHERE stock_quantity = 0 OR (stock_quantity > 0 AND stock_quantity <= low_stock_threshold) OR status <> 'active')::text AS total
       FROM products
       WHERE store_id = $1`,
      [storeId],
    ),
  ]);

  const alerts: InventoryAlert[] = result.rows.map((row): InventoryAlert | null => {
    const stock = row.stock_quantity;
    const threshold = row.low_stock_threshold;
    const outOfStock = stock === 0;
    const inactive = row.status !== 'active';
    const lowStock = stock > 0 && stock <= threshold;

    // Primary condition priority per product: out_of_stock > low_stock > inactive.
    // One alert per product prevents duplicate alert rows for the same item.
    let type: InventoryAlertType;
    let reason: string;
    let severity: InventoryAlertSeverity;
    let unavailable: boolean;

    if (outOfStock) {
      type = 'out_of_stock';
      reason = 'No units left in stock — product cannot be purchased.';
      severity = 'critical';
      unavailable = true;
    } else if (lowStock) {
      type = 'low_stock';
      // Low-stock products with active status remain purchasable.
      unavailable = false;
      const halfThreshold = Math.max(1, Math.floor(threshold / 2));
      if (stock <= halfThreshold) {
        reason = `Only ${stock} unit(s) left — at or below half the low-stock threshold (${threshold}).`;
        severity = 'critical';
      } else {
        reason = `${stock} unit(s) left — at or below the low-stock threshold of ${threshold}.`;
        severity = 'warning';
      }
    } else if (inactive) {
      type = 'inactive';
      reason = 'Product is not active and cannot be purchased.';
      severity = row.status === 'archived' ? 'info' : 'warning';
      unavailable = true;
    } else {
      return null; // No alert condition for this product.
    }

    return {
      id: `${row.id}:${type}`,
      productId: row.id,
      name: row.name,
      stockQuantity: stock,
      lowStockThreshold: threshold,
      status: row.status,
      type,
      reason,
      severity,
      lastUpdated: row.updated_at.toISOString(),
      unavailable,
    };
  }).filter((alert): alert is InventoryAlert => alert !== null);

  const countRow = countResult.rows[0];
  const counts = {
    outOfStock: Number(countRow?.out_of_stock ?? 0),
    lowStock: Number(countRow?.low_stock ?? 0),
    inactive: Number(countRow?.inactive ?? 0),
    total: Number(countRow?.total ?? 0),
    critical: Number(countRow?.critical ?? 0),
  };

  return { alerts, counts };
}

// ---------------------------------------------------------------------------
// Restock recommendations — deterministic, read-only.
//
// Recommendations are derived from current stock plus completed-sales velocity
// in a lookback window. They are estimates only: the AI may phrase or
// prioritize them, but it must not treat them as authoritative stock or sales
// totals, and the backend never creates purchase orders from them.
// ---------------------------------------------------------------------------

export interface GetRestockRecommendationsOptions {
  lookbackDays?: number;      // sales window for velocity (default 30)
  targetCoverageDays?: number; // days of stock to target (default 14)
  limit?: number;
}

export async function getRestockRecommendations(
  storeId: string,
  options: GetRestockRecommendationsOptions = {},
): Promise<RestockRecommendations> {
  const lookbackDays = Math.min(366, Math.max(7, Math.floor(options.lookbackDays ?? 30)));
  const targetCoverageDays = Math.max(1, Math.floor(options.targetCoverageDays ?? 14));
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));

  const timeZone = config.analyticsTimeZone;
  const today = todayInTimeZoneUTC(timeZone);
  const windowStart = addDaysUTC(today, -lookbackDays + 1); // inclusive window

  // Store default currency so we only count completed sales in that currency.
  const storeResult = await query<{ default_currency: string }>(
    'SELECT default_currency FROM stores WHERE id = $1',
    [storeId],
  );
  const currency = storeResult.rows[0]?.default_currency;
  if (!currency) {
    return { recommendations: [], dataCoverageNote: 'Store not found.' };
  }

  // Completed-sales units per product in the lookback window (confirmed order
  // with at least one paid transaction). This is the trusted demand signal.
  const salesResult = await query<{
    product_id: string;
    units_sold: string;
  }>(
    `WITH completed_sales AS (
       SELECT o.id AS order_id
       FROM orders o
       JOIN transactions t ON t.order_id = o.id AND t.status = 'paid'
       WHERE o.store_id = $1
         AND o.status = 'confirmed'
         AND o.currency = $2
         AND t.paid_at IS NOT NULL
         AND t.paid_at >= ($3::date AT TIME ZONE $4::text)
         AND t.paid_at < (($5::date + 1) AT TIME ZONE $4::text)
     )
     SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::bigint AS units_sold
     FROM order_items oi
     JOIN completed_sales cs ON cs.order_id = oi.order_id
     GROUP BY oi.product_id`,
    [storeId, currency, windowStart, timeZone, today],
  );

  const unitsSoldByProduct = new Map<string, number>();
  let totalUnitsSold = 0;
  for (const row of salesResult.rows) {
    const units = Number(row.units_sold);
    unitsSoldByProduct.set(row.product_id, units);
    totalUnitsSold += units;
  }

  // All products for the store — recommendations are generated for those
  // needing attention, but every product is considered so nothing is missed.
  const productsResult = await query<{
    id: string;
    name: string;
    stock_quantity: number;
    low_stock_threshold: number;
    status: ProductStatus;
  }>(
    `SELECT id, name, stock_quantity, low_stock_threshold, status
     FROM products
     WHERE store_id = $1 AND status = 'active'
     ORDER BY name ASC`,
    [storeId],
  );

  const hasStoreSales = totalUnitsSold > 0;
  const recommendations: RestockRecommendation[] = productsResult.rows.map((row) => {
    const stock = row.stock_quantity;
    const threshold = row.low_stock_threshold;
    const unitsSoldRecent = unitsSoldByProduct.get(row.id) ?? 0;
    const daysInWindow = Math.max(1, lookbackDays);
    const dailyVelocity = unitsSoldRecent / daysInWindow;
    const daysOfStock = dailyVelocity > 0 ? stock / dailyVelocity : null;

    let reason: RestockRecommendation['reason'];
    let suggestedQuantity: number | null = null;

    const dataReliable = unitsSoldRecent > 0;

    if (stock === 0) {
      reason = 'out_of_stock';
    } else if (daysOfStock !== null && daysOfStock <= targetCoverageDays / 2) {
      reason = 'low_days_of_stock';
    } else if (unitsSoldRecent > 0 && stock <= threshold * 1.5) {
      reason = 'high_velocity_low_stock';
    } else if (stock <= threshold) {
      reason = 'below_threshold';
    } else if (daysOfStock !== null && daysOfStock <= targetCoverageDays) {
      reason = 'low_days_of_stock';
    } else {
      reason = 'below_threshold';
    }

    // Suggest a restock quantity only when backed by real demand data.
    // Target: enough stock to cover `targetCoverageDays` of expected sales.
    if (dataReliable && dailyVelocity > 0) {
      const targetUnits = Math.ceil(dailyVelocity * targetCoverageDays);
      suggestedQuantity = Math.max(0, targetUnits - stock);
    }

    return {
      productId: row.id,
      name: row.name,
      currentStock: stock,
      lowStockThreshold: threshold,
      unitsSoldRecent,
      dailyVelocity: Number(dailyVelocity.toFixed(4)),
      daysOfStock: daysOfStock ? Number(daysOfStock.toFixed(1)) : null,
      reason,
      suggestedQuantity,
      dataReliable,
    };
  });

  // Only surface products that genuinely need attention, highest risk first.
  const attention = recommendations.filter((r) =>
    r.currentStock === 0 || r.currentStock <= r.lowStockThreshold ||
    (r.daysOfStock !== null && r.daysOfStock <= targetCoverageDays),
  );

  attention.sort((a, b) => {
    // Out of stock first, then fewest days of stock, then lowest stock.
    if (a.currentStock === 0 && b.currentStock !== 0) return -1;
    if (b.currentStock === 0 && a.currentStock !== 0) return 1;
    const da = a.daysOfStock ?? Infinity;
    const db = b.daysOfStock ?? Infinity;
    if (da !== db) return da - db;
    return a.currentStock - b.currentStock;
  });

  const limited = attention.slice(0, limit);

  let dataCoverageNote: string;
  if (!hasStoreSales) {
    dataCoverageNote = `No completed sales in the last ${lookbackDays} days. Products below their thresholds are flagged for review, but no restock quantities are estimated.`;
  } else if (limited.length === 0) {
    dataCoverageNote = `Based on ${totalUnitsSold} unit(s) sold in the last ${lookbackDays} days; no products currently need restocking attention.`;
  } else {
    dataCoverageNote = `Based on ${totalUnitsSold} unit(s) sold in the last ${lookbackDays} days across ${productsResult.rows.length} product(s).`;
  }

  return { recommendations: limited, dataCoverageNote };
}

function todayInTimeZoneUTC(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function addDaysUTC(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return dt.toISOString().slice(0, 10);
}
