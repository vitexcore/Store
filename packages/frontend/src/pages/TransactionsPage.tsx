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
        <p className="text-center text-sm text-slate-400">
          Transaction history will be implemented in Day 4 (payment flow).
        </p>
      </div>
    </div>
  );
}
