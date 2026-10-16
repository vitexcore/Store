export function ProductsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Products</h2>
          <p className="mt-1 text-sm text-slate-500">Manage your store's product catalogue.</p>
        </div>
        <button type="button" className="btn-primary" disabled>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add product
        </button>
      </div>

      <div className="card border-dashed bg-surface-subtle">
        <p className="text-center text-sm text-slate-400">
          Product listing and management will be implemented in Day 3.
        </p>
      </div>
    </div>
  );
}
