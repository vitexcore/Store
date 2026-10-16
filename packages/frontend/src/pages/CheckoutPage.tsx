/**
 * QR Checkout — generate QR codes for in-person payment collection.
 */
export function CheckoutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">QR Checkout</h2>
        <p className="mt-1 text-sm text-slate-500">
          Generate QR codes for in-person payment collection.
        </p>
      </div>

      {/* Simulated payment disclaimer — required by AGENTS.md */}
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
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          <p className="text-sm font-medium text-slate-500">QR checkout is not yet available</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Select an order and generate a QR code to accept in-person payment. Your customer scans the code to complete the transaction.
          </p>
        </div>
      </div>
    </div>
  );
}
