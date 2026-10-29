/**
 * Dashboard service — aggregated metrics from real DB data.
 *
 * Rules (per spec):
 *  - Revenue and order count include only confirmed orders with a paid
 *    transaction, in the store's default currency.
 *  - Low-stock = products with stock_quantity <= low_stock_threshold (non-archived).
 *  - Recent orders = last 5 orders (any status) for the activity feed.
 */

import { query } from '../db/pool.js';
import type { DashboardMetrics, OrderStatus } from '@store/shared';

interface MetricsRow {
  total_revenue_cents: string; // SUM returns text from pg
  confirmed_order_count: string;
  active_product_count: string;
  low_stock_product_count: string;
}

interface RecentOrderRow {
  id: string;
  reference: string;
  status: OrderStatus;
  total_cents: number;
  currency: string;
  customer_name: string | null;
  created_at: Date;
}

export async function getDashboardMetrics(storeId: string): Promise<DashboardMetrics> {
  // Single aggregated query for metrics — join stores to pick up the default currency
  const metricsResult = await query<MetricsRow & { default_currency: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN o.status = 'confirmed'
                           AND o.currency = s.default_currency
                           AND EXISTS (SELECT 1 FROM transactions t
                                       WHERE t.order_id = o.id AND t.status = 'paid')
                         THEN o.total_cents ELSE 0 END), 0) AS total_revenue_cents,
       COUNT(DISTINCT CASE WHEN o.status = 'confirmed'
                             AND o.currency = s.default_currency
                             AND EXISTS (SELECT 1 FROM transactions t
                                         WHERE t.order_id = o.id AND t.status = 'paid')
                           THEN o.id END) AS confirmed_order_count,
       (SELECT COUNT(*) FROM products WHERE store_id = $1 AND status = 'active')         AS active_product_count,
       (SELECT COUNT(*) FROM products
        WHERE store_id = $1 AND status <> 'archived'
          AND stock_quantity <= low_stock_threshold)                                      AS low_stock_product_count,
       s.default_currency
     FROM stores s
     LEFT JOIN orders o ON o.store_id = s.id
     WHERE s.id = $1
     GROUP BY s.default_currency`,
    [storeId],
  );

  // Recent orders for activity feed (last 5)
  const recentResult = await query<RecentOrderRow>(
    `SELECT id, reference, status, total_cents, currency, customer_name, created_at
     FROM orders
     WHERE store_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [storeId],
  );

  const m = metricsResult.rows[0]!;

  return {
    totalRevenueCents: parseInt(m.total_revenue_cents, 10),
    currency: m.default_currency,
    confirmedOrderCount: parseInt(m.confirmed_order_count, 10),
    activeProductCount: parseInt(m.active_product_count, 10),
    lowStockProductCount: parseInt(m.low_stock_product_count, 10),
    recentOrders: recentResult.rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      totalCents: r.total_cents,
      currency: r.currency,
      customerName: r.customer_name,
      createdAt: r.created_at.toISOString(),
    })),
  };
}
