/**
 * Transactions — payment transaction history.
 */
export function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Transactions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Payment records for your store.{' '}
          <span className="font-medium text-amber-700">All payments are simulated — no real funds are transferred.</span>
        </p>
      </div>

      <div className="card border-dashed bg-surface-subtle">
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <p className="text-sm font-medium text-slate-500">No transactions yet</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Completed payment records will appear here. Each entry shows the amount, status, order reference, and timestamp.
          </p>
        </div>
      </div>
    </div>
  );
}
