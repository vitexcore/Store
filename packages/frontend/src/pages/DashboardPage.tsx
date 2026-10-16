/**
 * Dashboard — summary metrics and quick actions.
 * Full implementation in Day 3.
 */
export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-500">
          Overview of your store's performance and recent activity.
        </p>
      </div>

      {/* Metric cards — placeholder */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Revenue', value: '—', note: 'Coming Day 3' },
          { label: 'Orders Today',  value: '—', note: 'Coming Day 3' },
          { label: 'Products',      value: '—', note: 'Coming Day 3' },
          { label: 'Transactions',  value: '—', note: 'Coming Day 3' },
        ].map((m) => (
          <div key={m.label} className="card" aria-label={`${m.label}: ${m.value}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{m.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{m.value}</p>
            <p className="mt-1 text-xs text-slate-400">{m.note}</p>
          </div>
        ))}
      </div>

      {/* Placeholder notice */}
      <div className="card border-dashed bg-surface-subtle">
        <p className="text-center text-sm text-slate-400">
          Full dashboard metrics and charts will be implemented in Day 3.
        </p>
      </div>
    </div>
  );
}
