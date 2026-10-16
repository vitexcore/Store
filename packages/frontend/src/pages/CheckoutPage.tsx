export function CheckoutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">QR Checkout</h2>
        <p className="mt-1 text-sm text-slate-500">
          Generate QR codes for in-person payment collection.
        </p>
      </div>

      {/* Simulated payment disclaimer — prominent and clear */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p className="text-sm font-medium text-amber-800">Demo mode — simulated payments only</p>
          <p className="mt-0.5 text-xs text-amber-700">
            This checkout system does not process real money. All transactions shown here are for demonstration purposes only.
          </p>
        </div>
      </div>

      <div className="card border-dashed bg-surface-subtle">
        <p className="text-center text-sm text-slate-400">
          QR checkout flow will be implemented in Day 4.
        </p>
      </div>
    </div>
  );
}
