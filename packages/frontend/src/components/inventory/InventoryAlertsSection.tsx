/**
 * Inventory alerts section — merchant-facing read-only view of stock issues.
 *
 * Alerts are computed on the backend from current product state (no persisted
 * alert rows), so they always reflect the latest trusted inventory data and
 * resolve automatically when stock changes.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryAlert, InventoryAlerts } from '@store/shared';
import { api } from '../../lib/api.js';
import { EmptyState, LoadingSpinner } from '../ui/EmptyState.js';

const TYPE_LABEL: Record<InventoryAlert['type'], string> = {
  out_of_stock: 'Out of stock',
  low_stock: 'Low stock',
  inactive: 'Inactive',
};

const SEVERITY_LABEL: Record<InventoryAlert['severity'], string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

export function InventoryAlertsSection(): JSX.Element {
  const [data, setData] = useState<InventoryAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.inventory.alerts().then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.message ?? 'Failed to load inventory alerts.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const alerts = data?.alerts ?? [];
  const counts = data?.counts ?? { outOfStock: 0, lowStock: 0, inactive: 0, total: 0, critical: 0 };

  if (loading) {
    return (
      <section aria-labelledby="inventory-alerts-heading" className="space-y-4">
        <div>
          <h3 id="inventory-alerts-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Inventory alerts
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Products that need your attention, based on current stock and thresholds.
          </p>
        </div>
        <LoadingSpinner label="Loading inventory alerts…" />
      </section>
    );
  }

  if (error) {
    return (
      <section aria-labelledby="inventory-alerts-heading" className="space-y-4">
        <div>
          <h3 id="inventory-alerts-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Inventory alerts
          </h3>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" role="alert">
          {error}
          <button type="button" className="btn-secondary self-start" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="inventory-alerts-heading" className="space-y-4">
      <div>
        <h3 id="inventory-alerts-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Inventory alerts
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Products that need your attention, based on current stock and configured thresholds.
        </p>
        <Link to="/products" className="mt-2 inline-flex text-sm font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-400 dark:hover:text-brand-300">
          Review products and update stock
        </Link>
      </div>

      {/* Summary chips */}
      <div className="grid gap-2 sm:grid-cols-4">
        <AlertChip label="Out of stock" value={counts.outOfStock} />
        <AlertChip label="Low stock" value={counts.lowStock} />
        <AlertChip label="Inactive" value={counts.inactive} />
        <AlertChip label="Critical" value={counts.critical} />
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          title="No inventory alerts"
          description="All your products are stocked and active. No items need attention right now."
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-10 w-10 text-emerald-400 dark:text-emerald-500"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Inventory alerts</caption>
            <thead>
              <tr className="border-b border-border dark:border-slate-700 bg-surface-subtle dark:bg-slate-900/50">
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Product</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Stock</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Threshold</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Alert type</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Severity</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Why it needs attention</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Last updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-slate-700">
              {alerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-surface-subtle dark:hover:bg-slate-700/40 transition-colors">
                  <td className="px-6 py-3 font-medium text-slate-700 dark:text-slate-300">{alert.name}</td>
                  <td className="px-6 py-3 text-right font-mono text-slate-900 dark:text-slate-100">{alert.stockQuantity}</td>
                  <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">{alert.lowStockThreshold}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`badge-${alert.type}`}
                      title={TYPE_LABEL[alert.type]}
                    >
                      {TYPE_LABEL[alert.type]}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`badge-${alert.severity}`}
                      title={SEVERITY_LABEL[alert.severity]}
                    >
                      {SEVERITY_LABEL[alert.severity]}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-slate-600 dark:text-slate-400">
                    {alert.reason}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-slate-600 dark:text-slate-400">
                    <time dateTime={alert.lastUpdated}>{new Date(alert.lastUpdated).toLocaleString()}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AlertChip({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const highlight = value > 0;
  return (
    <div
      className={`card ${highlight ? 'border-red-200 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20' : ''}`}
      aria-label={`${label}: ${value}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${highlight ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
