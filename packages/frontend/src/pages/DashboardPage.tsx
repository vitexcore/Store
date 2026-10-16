/**
 * Dashboard — summary metrics and quick actions.
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

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Revenue',   value: '—', note: 'No data yet' },
          { label: 'Orders Today',    value: '—', note: 'No data yet' },
          { label: 'Active Products', value: '—', note: 'No data yet' },
          { label: 'Transactions',    value: '—', note: 'No data yet' },
        ].map((m) => (
          <div key={m.label} className="card" aria-label={`${m.label}: ${m.value}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{m.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{m.value}</p>
            <p className="mt-1 text-xs text-slate-400">{m.note}</p>
          </div>
        ))}
      </div>

      {/* Empty state */}
      <div className="card border-dashed bg-surface-subtle">
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <p className="text-sm font-medium text-slate-500">Your dashboard is ready</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Sales metrics, revenue charts, and recent order activity will appear here once your store has data.
          </p>
        </div>
      </div>
    </div>
  );
}
