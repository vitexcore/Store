/**
 * Sales analytics service — deterministic merchant metrics from persisted data.
 *
 * Definitions (kept deliberately strict because these figures may later be
 * summarised by the AI assistant):
 *  - A "completed sale" is an order with status = 'confirmed' that also has at
 *    least one transaction with status = 'paid'. The payment record is the
 *    trusted proof; a manually confirmed order without a paid transaction is
 *    never counted as revenue.
 *  - Revenue is the sum of the stored order total (item price × quantity) for
 *    completed sales. No discounts, taxes, provider fees, or partial refunds
 *    are stored in the current schema, so none are applied.
 *  - Pending, failed, cancelled, refunded, and unverified orders are excluded.
 *  - A sale is dated by its first verified payment time (transactions.paid_at),
 *    not by order creation or checkout/QR activity.
 *  - Date boundaries and daily grouping use one configured IANA timezone.
 *  - Figures are limited to the store's current default currency so amounts in
 *    different currencies are never added together.
 *  - Average order value is revenue ÷ completed order count, rounded to the
 *    nearest minor unit (kobo/pence/cent) for display.
 *
 * All aggregation is performed in PostgreSQL; only aggregate rows are loaded
 * into application memory.
 */

import { query } from '../db/pool.js';
import { config } from '../config.js';
import type {
  SalesAnalytics,
  SalesAnalyticsComparison,
  SalesAnalyticsPreset,
  SalesAnalyticsRange,
  SalesDailyPoint,
  SalesProductPerformance,
} from '@store/shared';

export const ANALYTICS_PRESETS = ['today', '7d', '30d'] as const;
export const MAX_ANALYTICS_RANGE_DAYS = 366;

type PresetOption = (typeof ANALYTICS_PRESETS)[number];

export interface SalesAnalyticsQuery {
  preset?: unknown;
  start?: unknown;
  end?: unknown;
}

export class AnalyticsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsValidationError';
  }
}

interface ResolvedRange {
  start: string;
  end: string;
  preset: SalesAnalyticsPreset;
}

interface SummaryRow {
  revenue_cents: string;
  completed_order_count: string;
  previous_revenue_cents: string;
  previous_order_count: string;
}

interface DailyRow {
  day: string;
  revenue_cents: string;
  order_count: string;
}

interface ProductRow {
  product_id: string | null;
  name: string;
  quantity_sold: string;
  revenue_cents: string;
  order_count: string;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toInt(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : parseInt(value, 10);
}

function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return dt.toISOString().slice(0, 10);
}

function daysInclusive(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function parseDateOnly(value: unknown, field: 'start' | 'end'): string {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) {
    throw new AnalyticsValidationError(`${field} must be a date in YYYY-MM-DD format.`);
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new AnalyticsValidationError(`${field} is not a valid calendar date.`);
  }
  return value;
}

function resolveRange(input: SalesAnalyticsQuery, timeZone: string): ResolvedRange {
  const hasPreset = input.preset !== undefined;
  const hasStart = input.start !== undefined;
  const hasEnd = input.end !== undefined;

  if (hasPreset && (hasStart || hasEnd)) {
    throw new AnalyticsValidationError('Choose either a preset or a custom start/end date, not both.');
  }

  const today = todayInTimeZone(timeZone);

  if (hasPreset) {
    if (typeof input.preset !== 'string' || !(ANALYTICS_PRESETS as readonly string[]).includes(input.preset)) {
      throw new AnalyticsValidationError(`preset must be one of: ${ANALYTICS_PRESETS.join(', ')}.`);
    }
    const preset = input.preset as PresetOption;
    if (preset === 'today') return { start: today, end: today, preset };
    if (preset === '7d') return { start: addDays(today, -6), end: today, preset };
    return { start: addDays(today, -29), end: today, preset };
  }

  if (hasStart !== hasEnd) {
    throw new AnalyticsValidationError('Provide both start and end dates for a custom range.');
  }

  if (!hasStart && !hasEnd) {
    return { start: addDays(today, -6), end: today, preset: '7d' };
  }

  const start = parseDateOnly(input.start, 'start');
  const end = parseDateOnly(input.end, 'end');
  if (start > end) {
    throw new AnalyticsValidationError('start must be on or before end.');
  }
  const days = daysInclusive(start, end);
  if (days > MAX_ANALYTICS_RANGE_DAYS) {
    throw new AnalyticsValidationError(`Date range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days.`);
  }
  return { start, end, preset: 'custom' };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function mapProductRows(rows: ProductRow[]): SalesProductPerformance[] {
  return rows.map((row) => ({
    productId: row.product_id,
    name: row.name,
    quantitySold: toInt(row.quantity_sold),
    revenueCents: toInt(row.revenue_cents),
    orderCount: toInt(row.order_count),
  }));
}

export async function getSalesAnalytics(
  storeId: string,
  input: SalesAnalyticsQuery = {},
): Promise<SalesAnalytics> {
  const timeZone = config.analyticsTimeZone;
  const range = resolveRange(input, timeZone);
  const rangeDays = daysInclusive(range.start, range.end);

  const comparisonStart = addDays(range.start, -rangeDays);
  const comparisonEnd = addDays(range.start, -1);

  const storeResult = await query<{ default_currency: string }>(
    'SELECT default_currency FROM stores WHERE id = $1',
    [storeId],
  );
  const currency = storeResult.rows[0]?.default_currency;
  if (!currency) {
    throw new Error('Store not found.');
  }

  // Parameters shared by all analytics queries:
  //   $1 store, $2 currency, $3 timezone, $4 range start, $5 range end,
  //   $6 comparison start. The comparison period is always immediately before
  //   the selected period and has the same number of calendar days.
  const params = [storeId, currency, timeZone, range.start, range.end, comparisonStart];

  const summaryPromise = query<SummaryRow>(
    `WITH paid_orders AS (
       SELECT o.id, o.total_cents, MIN(t.paid_at) AS sale_at
       FROM orders o
       JOIN transactions t
         ON t.order_id = o.id
        AND t.status = 'paid'
       WHERE o.store_id = $1
         AND o.status = 'confirmed'
         AND o.currency = $2
         AND t.paid_at IS NOT NULL
         AND t.paid_at >= ($6::date AT TIME ZONE $3::text)
         AND t.paid_at < (($5::date + 1) AT TIME ZONE $3::text)
       GROUP BY o.id, o.total_cents
     )
     SELECT
       COALESCE(SUM(total_cents) FILTER (
         WHERE sale_at >= ($4::date AT TIME ZONE $3::text)
           AND sale_at < (($5::date + 1) AT TIME ZONE $3::text)
       ), 0)::bigint AS revenue_cents,
       COUNT(*) FILTER (
         WHERE sale_at >= ($4::date AT TIME ZONE $3::text)
           AND sale_at < (($5::date + 1) AT TIME ZONE $3::text)
       )::int AS completed_order_count,
       COALESCE(SUM(total_cents) FILTER (
         WHERE sale_at >= ($6::date AT TIME ZONE $3::text)
           AND sale_at < ($4::date AT TIME ZONE $3::text)
       ), 0)::bigint AS previous_revenue_cents,
       COUNT(*) FILTER (
         WHERE sale_at >= ($6::date AT TIME ZONE $3::text)
           AND sale_at < ($4::date AT TIME ZONE $3::text)
       )::int AS previous_order_count
     FROM paid_orders`,
    params,
  );

  const dailyPromise = query<DailyRow>(
    `WITH qualifying_orders AS (
       SELECT o.id, o.total_cents, MIN(t.paid_at) AS sale_at
       FROM orders o
       JOIN transactions t
         ON t.order_id = o.id
        AND t.status = 'paid'
       WHERE o.store_id = $1
         AND o.status = 'confirmed'
         AND o.currency = $2
         AND t.paid_at IS NOT NULL
         AND t.paid_at >= ($4::date AT TIME ZONE $3::text)
         AND t.paid_at < (($5::date + 1) AT TIME ZONE $3::text)
       GROUP BY o.id, o.total_cents
     )
     SELECT
       to_char((sale_at AT TIME ZONE $3::text)::date, 'YYYY-MM-DD') AS day,
       COALESCE(SUM(total_cents), 0)::bigint AS revenue_cents,
       COUNT(*)::int AS order_count
     FROM qualifying_orders
     GROUP BY 1
     ORDER BY 1`,
    [storeId, currency, timeZone, range.start, range.end],
  );

  const productParams = [storeId, currency, timeZone, range.start, range.end, 5];

  const productAggregateSql = `WITH qualifying_orders AS (
       SELECT o.id
       FROM orders o
       JOIN transactions t
         ON t.order_id = o.id
        AND t.status = 'paid'
       WHERE o.store_id = $1
         AND o.status = 'confirmed'
         AND o.currency = $2
         AND t.paid_at IS NOT NULL
         AND t.paid_at >= ($4::date AT TIME ZONE $3::text)
         AND t.paid_at < (($5::date + 1) AT TIME ZONE $3::text)
       GROUP BY o.id
     )
     SELECT
       oi.product_id,
       COALESCE(p.name, oi.product_name) AS name,
       SUM(oi.quantity)::bigint AS quantity_sold,
       SUM(oi.total_cents)::bigint AS revenue_cents,
       COUNT(DISTINCT oi.order_id)::int AS order_count
     FROM order_items oi
     JOIN qualifying_orders q ON q.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     GROUP BY oi.product_id, COALESCE(p.name, oi.product_name)`;

  const topProductsPromise = query<ProductRow>(
    `${productAggregateSql}
     ORDER BY quantity_sold DESC, revenue_cents DESC, name ASC
     LIMIT $6`,
    productParams,
  );

  const slowestProductsPromise = query<ProductRow>(
    `${productAggregateSql}
     ORDER BY quantity_sold ASC, revenue_cents ASC, name ASC
     LIMIT $6`,
    productParams,
  );

  const [summaryResult, dailyResult, topProductsResult, slowestProductsResult] = await Promise.all([
    summaryPromise,
    dailyPromise,
    topProductsPromise,
    slowestProductsPromise,
  ]);

  const summary = summaryResult.rows[0];
  const revenueCents = toInt(summary?.revenue_cents);
  const completedOrderCount = toInt(summary?.completed_order_count);
  const previousRevenueCents = toInt(summary?.previous_revenue_cents);
  const previousOrderCount = toInt(summary?.previous_order_count);

  const dailyByDate = new Map(
    dailyResult.rows.map((row) => [
      row.day,
      { revenueCents: toInt(row.revenue_cents), orderCount: toInt(row.order_count) },
    ]),
  );

  const daily: SalesDailyPoint[] = [];
  let cursor = range.start;
  for (let i = 0; i < rangeDays; i++) {
    const point = dailyByDate.get(cursor);
    daily.push({
      date: cursor,
      revenueCents: point?.revenueCents ?? 0,
      orderCount: point?.orderCount ?? 0,
    });
    cursor = addDays(cursor, 1);
  }

  const comparison: SalesAnalyticsComparison = {
    start: comparisonStart,
    end: comparisonEnd,
    revenueCents: previousRevenueCents,
    completedOrderCount: previousOrderCount,
    averageOrderValueCents:
      previousOrderCount > 0 ? Math.round(previousRevenueCents / previousOrderCount) : 0,
    revenueChangeCents: revenueCents - previousRevenueCents,
    revenueChangePercent: percentChange(revenueCents, previousRevenueCents),
    orderCountChange: completedOrderCount - previousOrderCount,
    orderCountChangePercent: percentChange(completedOrderCount, previousOrderCount),
  };

  const analyticsRange: SalesAnalyticsRange = {
    start: range.start,
    end: range.end,
    preset: range.preset,
    timezone: timeZone,
    days: rangeDays,
  };

  const limitations = [
    'Revenue counts only orders marked Confirmed that also have a verified successful payment record. Pending, failed, cancelled, refunded, and unverified orders are excluded.',
    'Revenue is the sum of stored order totals (item price × quantity). No discounts, taxes, or provider fees are stored, and partial refunds are not tracked.',
    `Sales are dated by the first verified payment time and grouped by calendar day in ${timeZone}.`,
    `Only orders in the store's current default currency (${currency}) are included.`,
  ];
  if (!config.paystackSecretKey) {
    limitations.push(
      'Paystack is not configured in this environment, so new payments cannot be verified and will not appear as completed sales.',
    );
  }

  return {
    currency,
    range: analyticsRange,
    comparison,
    revenueCents,
    completedOrderCount,
    averageOrderValueCents:
      completedOrderCount > 0 ? Math.round(revenueCents / completedOrderCount) : 0,
    daily,
    topProducts: mapProductRows(topProductsResult.rows),
    slowestProducts: mapProductRows(slowestProductsResult.rows),
    limitations,
  };
}
