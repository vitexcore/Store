/**
 * Restock recommendations section — merchant-facing read-only draft of
 * suggested restocking priorities.
 *
 * Recommendations are deterministic backend estimates based on current stock
 * plus completed-sales velocity in a lookback window. They are drafts only:
 * suggested quantities are estimates and no purchase orders are created.
 */

import { useEffect, useState } from 'react';
import type { RestockRecommendation } from '@store/shared';
import { api } from '../../lib/api.js';
import { EmptyState, LoadingSpinner } from '../ui/EmptyState.js';

const REASON_LABEL: Record<RestockRecommendation['reason'], string> = {
  out_of_stock: 'Out of stock',
  below_threshold: 'Below low-stock threshold',
  low_days_of_stock: 'Low days of stock remaining',
  high_velocity_low_stock: 'Selling fast, stock running low',
};

export function RestockRecommendationsSection(): JSX.Element {
  const [data, setData] = useState<{ recommendations: RestockRecommendation[]; dataCoverageNote: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.inventory.restockRecommendations().then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.message ?? 'Failed to load restock recommendations.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const recommendations = data?.recommendations ?? [];
  const coverageNote = data?.dataCoverageNote ?? '';

  if (loading) {
    return (
      <section aria-labelledby="restock-recommendations-heading" className="space-y-4">
        <div>
          <h3 id="restock-recommendations-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Restock recommendations
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Suggested restocking priorities based on current stock and recent sales.
          </p>
        </div>
        <LoadingSpinner label="Loading restock recommendations…" />
      </section>
    );
  }

  if (error) {
    return (
      <section aria-labelledby="restock-recommendations-heading" className="space-y-4">
        <div>
          <h3 id="restock-recommendations-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Restock recommendations
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
    <section aria-labelledby="restock-recommendations-heading" className="space-y-4">
      <div>
        <h3 id="restock-recommendations-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Restock recommendations
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Suggested restocking priorities based on current stock and recent sales velocity.
        </p>
        {coverageNote && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{coverageNote}</p>
        )}
      </div>

      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Suggested quantities are estimates only — not purchase orders.
      </p>

      {recommendations.length === 0 ? (
        <EmptyState
          title="No restocking needed"
          description="Based on recent sales, no products currently require restocking attention."
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
            <caption className="sr-only">Restock recommendations</caption>
            <thead>
              <tr className="border-b border-border dark:border-slate-700 bg-surface-subtle dark:bg-slate-900/50">
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Product</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Current stock</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Threshold</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Sold (30d)</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Days of stock</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Suggested qty (est.)</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-slate-700">
              {recommendations.map((rec) => (
                <tr key={rec.productId} className="hover:bg-surface-subtle dark:hover:bg-slate-700/40 transition-colors">
                  <td className="px-6 py-3 font-medium text-slate-700 dark:text-slate-300">{rec.name}</td>
                  <td className="px-6 py-3 text-right font-mono text-slate-900 dark:text-slate-100">{rec.currentStock}</td>
                  <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">{rec.lowStockThreshold}</td>
                  <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">{rec.unitsSoldRecent.toLocaleString()}</td>
                  <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">
                    {rec.daysOfStock === null ? '—' : rec.daysOfStock.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {rec.suggestedQuantity === null ? (
                      <span className="text-slate-500 dark:text-slate-500">—</span>
                    ) : (
                      <>
                        {rec.suggestedQuantity.toLocaleString()}{' '}
                        <span className="ml-1 text-[10px] text-slate-500 dark:text-slate-500">est.</span>
                      </>
                    )}
                  </td>
                  <td className="px-6 py-3 text-slate-600 dark:text-slate-400">
                    {REASON_LABEL[rec.reason]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!recDataReliable(recommendations) && (
            <p className="px-6 py-3 text-xs text-amber-600 dark:text-amber-400 border-t border-border dark:border-slate-700">
              Some suggestions lack sufficient recent sales history and are threshold-based estimates only.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function recDataReliable(recommendations: RestockRecommendation[]): boolean {
  return recommendations.every((r) => r.dataReliable);
}
