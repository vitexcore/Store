/**
 * Products — product catalogue management.
 */
export function ProductsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Products</h2>
          <p className="mt-1 text-sm text-slate-500">Manage your store's product catalogue.</p>
        </div>
        <button type="button" className="btn-primary" disabled aria-disabled="true">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add product
        </button>
      </div>

      <div className="card border-dashed bg-surface-subtle">
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-slate-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <p className="text-sm font-medium text-slate-500">No products yet</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Add your first product to start building your catalogue. Products you create will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
