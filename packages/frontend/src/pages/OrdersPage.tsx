import { useState, useEffect, useCallback } from 'react';
import { api, type OrderRow } from '../lib/api.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { Pagination } from '../components/ui/Pagination.js';
import { EmptyState, LoadingSpinner } from '../components/ui/EmptyState.js';
import { formatCurrency, formatDateTime } from '../lib/currency.js';

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.orders.list({ page, pageSize: 20 });
    if (res.ok) {
      setOrders(res.data.items);
      setMeta(res.data.meta);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Orders</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Customer orders for your store. Order status and payment status are tracked separately.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading && <LoadingSpinner label="Loading orders…" />}

      {!loading && orders.length === 0 && (
        <EmptyState
          title="No orders yet"
          description="Customer orders will appear here. Orders are created when a customer completes a QR checkout payment."
          icon={
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300 dark:text-slate-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
      )}

      {!loading && orders.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border dark:border-slate-700 bg-surface-subtle dark:bg-slate-900/50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Order status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-slate-700">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-subtle dark:hover:bg-slate-700/40 transition-colors">
                    <td className="px-6 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{o.reference}</td>
                    <td className="px-6 py-3">
                      <p className="text-slate-700 dark:text-slate-300">{o.customer_name ?? <span className="text-slate-400">—</span>}</p>
                      {o.customer_email && <p className="text-xs text-slate-400 dark:text-slate-500">{o.customer_email}</p>}
                    </td>
                    <td className="px-6 py-3">
                      <StatusBadge status={o.status as Parameters<typeof StatusBadge>[0]['status']} />
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(o.total_cents, o.currency)}
                    </td>
                    <td className="px-6 py-3 text-slate-500 dark:text-slate-400 text-xs">{formatDateTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6">
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              total={meta.total}
              pageSize={meta.pageSize}
              onPage={setPage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
