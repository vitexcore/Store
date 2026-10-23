import { useEffect, useState, type FormEvent } from 'react';
import type {
  SalesAnalytics,
  SalesAnalyticsPreset,
  SalesProductPerformance,
} from '@store/shared';
import { api } from '../../lib/api.js';
import { formatCurrency, formatDateOnly } from '../../lib/currency.js';
import { EmptyState, LoadingSpinner } from '../ui/EmptyState.js';

type PresetOption = Exclude<SalesAnalyticsPreset, 'custom'>;

interface RangeRequest {
  preset?: PresetOption;
  start?: string;
  end?: string;
}

const PRESET_OPTIONS: Array<{ id: PresetOption; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

const MAX_RANGE_DAYS = 366;

function formatPercentChange(value: number | null): string {
  if (value === null) return 'No prior-period baseline';
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatRange(start: string, end: string): string {
  if (start === end) return formatDateOnly(start);
  return `${formatDateOnly(start)} – ${formatDateOnly(end)}`;
}

export function SalesAnalyticsPanel() {
  const [activePreset, setActivePreset] = useState<SalesAnalyticsPreset>('7d');
  const [request, setRequest] = useState<RangeRequest>({ preset: '7d' });
  const [data, setData] = useState<SalesAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.analytics.sales(request).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setData(res.data);
        setDraftStart(res.data.range.start);
        setDraftEnd(res.data.range.end);
      } else {
        setError(res.message);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [request, retryToken]);

  function selectPreset(preset: PresetOption) {
    setActivePreset(preset);
    setFormError(null);
    setRequest({ preset });
  }

  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!draftStart || !draftEnd) {
      setFormError('Select both a start and an end date.');
      return;
    }
    if (draftStart > draftEnd) {
      setFormError('The start date must be on or before the end date.');
      return;
    }

    const startMs = Date.parse(`${draftStart}T00:00:00Z`);
    const endMs = Date.parse(`${draftEnd}T00:00:00Z`);
    const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
    if (!Number.isFinite(days) || days < 1 || days > MAX_RANGE_DAYS) {
      setFormError('Choose a valid range of 366 days or fewer.');
      return;
    }

    setActivePreset('custom');
    setRequest({ start: draftStart, end: draftEnd });
  }

  const currency = data?.currency ?? 'NGN';
  const hasSales = data !== null && data.completedOrderCount > 0;

  return (
    <section aria-labelledby="sales-analytics-heading" className="space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h3
            id="sales-analytics-heading"
            className="text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            Sales analytics
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Deterministic figures from verified completed payments. Pending, failed, cancelled,
            refunded, and unverified orders are excluded.
          </p>
          {data && (
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {formatRange(data.range.start, data.range.end)} · {data.range.timezone}
            </p>
          )}
        </div>

        <form onSubmit={applyCustomRange} className="space-y-2" aria-label="Analytics date range">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Preset date ranges">
            {PRESET_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={activePreset === option.id ? 'btn-primary' : 'btn-secondary'}
                aria-pressed={activePreset === option.id}
                onClick={() => selectPreset(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="analytics-start" className="label text-xs">
                From
              </label>
              <input
                id="analytics-start"
                type="date"
                className="input w-auto"
                value={draftStart}
                onChange={(event) => setDraftStart(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="analytics-end" className="label text-xs">
                To
              </label>
              <input
                id="analytics-end"
                type="date"
                className="input w-auto"
                value={draftEnd}
                onChange={(event) => setDraftEnd(event.target.value)}
              />
            </div>
            <button type="submit" className="btn-secondary">
              Apply range
            </button>
          </div>
          {formError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
        </form>
      </div>

      {error && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            className="btn-secondary self-start sm:self-auto"
            onClick={() => setRetryToken((token) => token + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data && <LoadingSpinner label="Loading sales analytics…" />}
      {loading && data && (
        <p role="status" className="text-xs text-slate-400 dark:text-slate-500">
          Updating analytics…
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric
              label="Revenue"
              value={formatCurrency(data.revenueCents, currency)}
              note={`${formatPercentChange(data.comparison.revenueChangePercent)} vs previous period`}
            />
            <SummaryMetric
              label="Completed orders"
              value={data.completedOrderCount.toLocaleString()}
              note={`${formatPercentChange(data.comparison.orderCountChangePercent)} vs previous period (${data.comparison.completedOrderCount.toLocaleString()} orders)`}
            />
            <SummaryMetric
              label="Average order value"
              value={formatCurrency(data.averageOrderValueCents, currency)}
              note={`Previous period: ${formatCurrency(data.comparison.averageOrderValueCents, currency)}`}
            />
            <SummaryMetric
              label="Previous period revenue"
              value={formatCurrency(data.comparison.revenueCents, currency)}
              note={formatRange(data.comparison.start, data.comparison.end)}
            />
          </div>

          {!hasSales ? (
            <EmptyState
              title="No completed sales in this period"
              description="Only orders with a verified successful payment are counted. Change the date range or wait for a verified payment."
              icon={
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="h-10 w-10 text-slate-300 dark:text-slate-600"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 17l6-6 4 4 8-8M14 7h7v7"
                  />
                </svg>
              }
            />
          ) : (
            <>
              <div className="card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Daily sales trend
                    </h4>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Revenue per calendar day · {data.range.timezone}
                    </p>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Peak day: {formatCurrency(Math.max(...data.daily.map((day) => day.revenueCents)), currency)}
                  </p>
                </div>
                <SalesTrendChart daily={data.daily} currency={currency} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ProductPerformanceTable
                  title="Best sellers"
                  description="Highest quantities sold in this period."
                  products={data.topProducts}
                  currency={currency}
                  emptyText="No product sales recorded in this period."
                  valueLabel="Units sold"
                />
                <ProductPerformanceTable
                  title="Slowest sellers"
                  description="Lowest quantities sold among products that sold at least once in this period."
                  products={data.slowestProducts}
                  currency={currency}
                  emptyText="No product sales recorded in this period."
                  valueLabel="Units sold"
                />
              </div>
            </>
          )}

          <div className="card">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              How these figures are calculated
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
              {data.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="card" aria-label={`${label}: ${value}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{note}</p>
    </div>
  );
}

function SalesTrendChart({
  daily,
  currency,
}: {
  daily: SalesAnalytics['daily'];
  currency: string;
}) {
  const peak = Math.max(...daily.map((day) => day.revenueCents), 0);
  const scale = Math.max(peak, 1);

  return (
    <div className="mt-4">
      <div className="flex h-44 items-end gap-1" aria-hidden="true">
        {daily.map((day) => {
          const height = day.revenueCents === 0 ? 2 : Math.max(4, (day.revenueCents / scale) * 100);
          return (
            <div
              key={day.date}
              className="flex h-full min-w-0 flex-1 items-end"
              title={`${formatDateOnly(day.date)}: ${formatCurrency(day.revenueCents, currency)} from ${day.orderCount} completed ${day.orderCount === 1 ? 'order' : 'orders'}`}
            >
              <div
                className={`w-full rounded-t ${
                  day.revenueCents === 0
                    ? 'bg-slate-200 dark:bg-slate-700'
                    : 'bg-brand-500 dark:bg-brand-400'
                }`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-400 dark:text-slate-500">
        <span>{formatDateOnly(daily[0]!.date)}</span>
        <span>{formatDateOnly(daily[daily.length - 1]!.date)}</span>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
          View daily figures
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border dark:border-slate-700">
          <table className="w-full text-sm">
            <caption className="sr-only">Daily revenue and completed orders</caption>
            <thead className="sticky top-0 bg-surface-subtle dark:bg-slate-900/90">
              <tr>
                <th scope="col" className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Date</th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Revenue</th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Orders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-slate-700">
              {daily.map((day) => (
                <tr key={day.date}>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{formatDateOnly(day.date)}</td>
                  <td className="px-4 py-2 text-right text-slate-700 dark:text-slate-200">{formatCurrency(day.revenueCents, currency)}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{day.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ProductPerformanceTable({
  title,
  description,
  products,
  currency,
  emptyText,
  valueLabel,
}: {
  title: string;
  description: string;
  products: SalesProductPerformance[];
  currency: string;
  emptyText: string;
  valueLabel: string;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="border-b border-border px-5 py-4 dark:border-slate-700">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      {products.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="bg-surface-subtle dark:bg-slate-900/50">
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Product</th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{valueLabel}</th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-slate-700">
              {products.map((product) => (
                <tr key={`${product.productId ?? 'deleted'}-${product.name}`}>
                  <td className="px-5 py-2.5 text-slate-700 dark:text-slate-300">
                    {product.name}
                    {product.productId === null && (
                      <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">(deleted product)</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium text-slate-900 dark:text-slate-100">{product.quantitySold.toLocaleString()}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600 dark:text-slate-300">{formatCurrency(product.revenueCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
