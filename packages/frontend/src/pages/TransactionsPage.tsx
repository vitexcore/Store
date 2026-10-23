import { useState, useEffect, useCallback } from 'react';
import { api, type TransactionRow } from '../lib/api.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { Pagination } from '../components/ui/Pagination.js';
import { EmptyState, LoadingSpinner } from '../components/ui/EmptyState.js';
import { formatCurrency, formatDateTime } from '../lib/currency.js';

export function TransactionsPage() {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.transactions.list({ page, pageSize: 20 });
    if (res.ok) {
      setTransactions(res.data.items);
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
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Transactions</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Payment records for your store.{' '}
          <span className="font-medium text-amber-700 dark:text-amber-400">Payments use Paystack test mode; no real funds are transferred.</span>
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading && <LoadingSpinner label="Loading transactions…" />}

      {!loading && transactions.length === 0 && (
        <EmptyState
          title="No transactions yet"
          description="Payment records will appear here after customers complete QR checkout flows."
          icon={
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300 dark:text-slate-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          }
        />
      )}

      {!loading && transactions.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border dark:border-slate-700 bg-surface-subtle dark:bg-slate-900/50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Order ref</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Paid at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-slate-700">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-subtle dark:hover:bg-slate-700/40 transition-colors">
                    <td className="px-6 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{t.order_reference}</td>
                    <td className="px-6 py-3">
                      <StatusBadge status={t.status as Parameters<typeof StatusBadge>[0]['status']} />
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(t.amount_cents, t.currency)}
                    </td>
                    <td className="px-6 py-3 text-slate-500 dark:text-slate-400 text-xs">{formatDateTime(t.created_at)}</td>
                    <td className="px-6 py-3 text-slate-500 dark:text-slate-400 text-xs">
                      {t.paid_at ? formatDateTime(t.paid_at) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                    </td>
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
