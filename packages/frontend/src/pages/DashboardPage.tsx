import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { LoadingSpinner } from '../components/ui/EmptyState.js';
import { formatCurrency, formatDate } from '../lib/currency.js';
import type { DashboardMetrics } from '@store/shared';

export function DashboardPage() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.dashboard.get().then((res) => {
      if (!mounted) return;
      if (res.ok) setMetrics(res.data);
      else setError(res.message);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Welcome back{user?.storeName ? `, ${user.storeName}` : ''}. Here's your store overview.
        </p>
      </div>

      {loading && <LoadingSpinner label="Loading dashboard…" />}

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {!loading && metrics && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Total Revenue"
              value={formatCurrency(metrics.totalRevenueCents, metrics.currency)}
              note="Confirmed orders only"
              icon={<RevenueIcon />}
            />
            <MetricCard
              label="Confirmed Orders"
              value={metrics.confirmedOrderCount.toString()}
              note="All time"
              icon={<OrderIcon />}
            />
            <MetricCard
              label="Active Products"
              value={metrics.activeProductCount.toString()}
              note="In your catalogue"
              icon={<ProductIcon />}
            />
            <MetricCard
              label="Low Stock"
              value={metrics.lowStockProductCount.toString()}
              note={metrics.lowStockProductCount > 0 ? 'Needs attention' : 'All stocked'}
              highlight={metrics.lowStockProductCount > 0}
              icon={<StockIcon />}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <QuickAction href="/products" label="Manage Products" description="Add, edit, or archive products" icon={<ProductIcon />} />
            <QuickAction href="/orders" label="View Orders" description="Track customer orders" icon={<OrderIcon />} />
            <QuickAction href="/settings" label="Store Settings" description="Update your store profile" icon={<SettingsIcon />} />
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-border dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent Orders</h3>
            </div>
            {metrics.recentOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <p className="text-sm text-slate-500 dark:text-slate-400">No orders yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Orders will appear here once customers place them via QR checkout.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border dark:border-slate-700 bg-surface-subtle dark:bg-slate-900/50">
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Reference</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border dark:divide-slate-700">
                    {metrics.recentOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-surface-subtle dark:hover:bg-slate-700/40 transition-colors">
                        <td className="px-6 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{order.reference}</td>
                        <td className="px-6 py-3 text-slate-600 dark:text-slate-300">{order.customerName ?? <span className="text-slate-400">—</span>}</td>
                        <td className="px-6 py-3"><StatusBadge status={order.status} /></td>
                        <td className="px-6 py-3 text-right font-medium text-slate-900 dark:text-slate-100">{formatCurrency(order.totalCents, order.currency)}</td>
                        <td className="px-6 py-3 text-slate-500 dark:text-slate-400">{formatDate(order.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {metrics.recentOrders.length > 0 && (
              <div className="px-6 py-3 border-t border-border dark:border-slate-700">
                <Link to="/orders" className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
                  View all orders →
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, note, icon, highlight }: {
  label: string; value: string; note: string; icon: React.ReactNode; highlight?: boolean;
}) {
  return (
    <div
      className={`card ${highlight ? 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20' : ''}`}
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span className={highlight ? 'text-amber-600 dark:text-amber-400' : 'text-brand-600 dark:text-brand-400'}>{icon}</span>
      </div>
      <p className={`mt-2 text-3xl font-bold ${highlight ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{note}</p>
    </div>
  );
}

function QuickAction({ href, label, description, icon }: {
  href: string; label: string; description: string; icon: React.ReactNode;
}) {
  return (
    <Link to={href} className="card hover:shadow-card-hover transition-shadow flex items-start gap-3 group">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 group-hover:bg-brand-600 group-hover:text-white dark:group-hover:bg-brand-600 transition-colors shrink-0">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      </div>
    </Link>
  );
}

function RevenueIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function OrderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}
function ProductIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}
function StockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
