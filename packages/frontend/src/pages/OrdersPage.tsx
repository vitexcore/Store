/**
 * Orders — customer order management.
 */
export function OrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Orders</h2>
        <p className="mt-1 text-sm text-slate-500">View and manage customer orders.</p>
      </div>

      <div className="card border-dashed bg-surface-subtle">
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm font-medium text-slate-500">No orders yet</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Customer orders will appear here. You can track status, view items, and manage fulfilment from this page.
          </p>
        </div>
      </div>
    </div>
  );
}
