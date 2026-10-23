import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useCart } from '../lib/cart.js';
import { formatCurrency } from '../lib/currency.js';
import { LoadingSpinner } from '../components/ui/EmptyState.js';
import { ThemeToggle } from '../components/ui/ThemeToggle.js';
import type { StorefrontProduct, StorefrontInfo } from '@store/shared';

export function StorefrontPage() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const navigate = useNavigate();
  const { addItem, itemCount, displayTotalCents, state: cartState } = useCart();

  const [store, setStore] = useState<StorefrontInfo | null>(null);
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!storeSlug) return;
    setLoading(true);
    setError(null);
    const res = await api.storefront.getProducts(storeSlug, { page, pageSize: 20 });
    if (res.ok) {
      setStore(res.data.store);
      setProducts(res.data.products);
      setMeta(res.data.meta);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, [storeSlug, page]);

  useEffect(() => { load(); }, [load]);

  const handleAddToCart = useCallback((product: StorefrontProduct) => {
    if (!storeSlug) return;
    addItem(product, storeSlug);
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.add(product.id);
      setTimeout(() => setAddedIds((p) => { const n = new Set(p); n.delete(product.id); return n; }), 1500);
      return next;
    });
  }, [addItem, storeSlug]);

  const cartCurrency = cartState.items[0]?.currency ?? store?.defaultCurrency ?? 'NGN';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-10 bg-white dark:bg-slate-800 border-b border-border dark:border-slate-700 shadow-sm">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 flex items-center justify-between h-16">
          <div>
            {store && (
              <>
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{store.name}</h1>
                {store.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block truncate max-w-xs">{store.description}</p>
                )}
              </>
            )}
            {!store && <div className="h-5 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => navigate(`/store/${storeSlug}/checkout`)}
              disabled={itemCount === 0}
              className="relative flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`View cart, ${itemCount} item${itemCount !== 1 ? 's' : ''}`}
            >
              <CartIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Cart</span>
              {itemCount > 0 && (
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">·</span>
                  <span>{formatCurrency(displayTotalCents, cartCurrency)}</span>
                </span>
              )}
              {itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-900">
                  {itemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex gap-3 items-start">
          <AlertIcon className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Payments are simulated using Paystack test mode and do not transfer real funds.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 mb-6 text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
            <button onClick={load} className="ml-3 underline font-medium">Retry</button>
          </div>
        )}

        {loading && <LoadingSpinner label="Loading products…" />}

        {!loading && !error && products.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BoxIcon className="h-12 w-12 text-slate-200 dark:text-slate-700 mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-300">No products available</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">This store has no products available for purchase right now.</p>
          </div>
        )}

        {!loading && products.length > 0 && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">{meta.total} product{meta.total !== 1 ? 's' : ''} available</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  justAdded={addedIds.has(product.id)}
                  onAddToCart={() => handleAddToCart(product)}
                />
              ))}
            </div>

            {meta.totalPages > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-border dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="flex items-center px-3 text-sm text-slate-500 dark:text-slate-400">
                  Page {meta.page} of {meta.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                  className="rounded-lg border border-border dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {itemCount > 0 && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4 sm:hidden">
          <button
            onClick={() => navigate(`/store/${storeSlug}/checkout`)}
            className="w-full max-w-sm rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-700 transition-colors"
          >
            Proceed to Checkout · {formatCurrency(displayTotalCents, cartCurrency)} ({itemCount} item{itemCount !== 1 ? 's' : ''})
          </button>
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  justAdded,
  onAddToCart,
}: {
  product: StorefrontProduct;
  justAdded: boolean;
  onAddToCart: () => void;
}) {
  const isOutOfStock = !product.available;

  return (
    <article className="flex flex-col rounded-xl border border-border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      <div className="aspect-square bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <BoxIcon className="h-12 w-12 text-slate-300 dark:text-slate-600" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 leading-tight">{product.name}</h3>
        {product.description && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{product.description}</p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {formatCurrency(product.priceCents, product.currency)}
          </span>
          {isOutOfStock ? (
            <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              Out of stock
            </span>
          ) : product.stockQuantity <= 5 ? (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {product.stockQuantity} left
            </span>
          ) : null}
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={onAddToCart}
            disabled={isOutOfStock}
            className={[
              'w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
              justAdded
                ? 'bg-green-600 text-white'
                : isOutOfStock
                ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                : 'bg-brand-600 text-white hover:bg-brand-700',
            ].join(' ')}
            aria-label={isOutOfStock ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
          >
            {justAdded ? '✓ Added' : isOutOfStock ? 'Out of stock' : 'Add to cart'}
          </button>
        </div>
      </div>
    </article>
  );
}

function CartIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}
function BoxIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}
function AlertIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}
