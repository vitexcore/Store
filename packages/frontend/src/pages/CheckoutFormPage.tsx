import { useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useCart } from '../lib/cart.js';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/currency.js';

export function CheckoutFormPage() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const navigate = useNavigate();
  const { state: cartState, removeItem, increment, decrement, clearCart } = useCart();

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const idempotencyKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const items = cartState.items;
  const currency = items[0]?.currency ?? 'NGN';
  const displayTotal = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (customerName.trim().length > 200) {
      errors['customerName'] = 'Name must be at most 200 characters.';
    }
    if (customerEmail.trim()) {
      if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(customerEmail.trim())) {
        errors['customerEmail'] = 'Please enter a valid email address.';
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [customerName, customerEmail]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || items.length === 0 || !storeSlug) return;
    if (!validate()) return;

    setSubmitting(true);
    setError(null);

    const orderPayload = {
      storeSlug,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      customerName: customerName.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
    };
    const fingerprint = JSON.stringify(orderPayload);
    if (idempotencyKeyRef.current?.fingerprint !== fingerprint) {
      idempotencyKeyRef.current = { fingerprint, key: uuidv4() };
    }
    const idempotencyKey = idempotencyKeyRef.current.key;
    const res = await api.checkout.createOrder({ idempotencyKey, ...orderPayload });

    if (res.ok) {
      clearCart();
      navigate(`/payment/${res.data.paymentToken}`);
    } else {
      setError(res.message);
    }
    setSubmitting(false);
  }, [submitting, items, storeSlug, validate, customerName, customerEmail, clearCart, navigate]);

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <CartEmptyIcon className="mx-auto h-12 w-12 text-slate-200 dark:text-slate-700 mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-300">Your cart is empty</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Add some products before checking out.</p>
          {storeSlug && (
            <Link to={`/store/${storeSlug}`} className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Browse products
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-border dark:border-slate-700 shadow-sm">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 flex items-center gap-3 h-16">
          {storeSlug && (
            <Link to={`/store/${storeSlug}`} className="rounded-lg p-1 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Back to store">
              <BackIcon className="h-5 w-5" />
            </Link>
          )}
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Checkout</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-8 space-y-6">
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex gap-3 items-start">
          <AlertIcon className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <strong>Paystack test mode.</strong> No real funds will be transferred.
          </p>
        </div>

        <section aria-label="Order summary" className="rounded-xl border border-border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Order Summary</h2>
          </div>
          <ul className="divide-y divide-border dark:divide-slate-700">
            {items.map((item) => (
              <li key={item.productId} className="px-6 py-4 flex items-center gap-4">
                <div className="flex-shrink-0 h-12 w-12 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <BoxIcon className="h-6 w-6 text-slate-300 dark:text-slate-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{item.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{formatCurrency(item.priceCents, item.currency)} each</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decrement(item.productId)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-bold"
                    aria-label={`Decrease quantity of ${item.name}`}
                  >−</button>
                  <span className="w-6 text-center text-sm font-medium text-slate-900 dark:text-slate-100">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => increment(item.productId)}
                    disabled={item.quantity >= item.maxStock}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-bold disabled:opacity-30"
                    aria-label={`Increase quantity of ${item.name}`}
                  >+</button>
                </div>

                <div className="text-right min-w-[5rem]">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(item.priceCents * item.quantity, item.currency)}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    className="text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    aria-label={`Remove ${item.name} from cart`}
                  >Remove</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Estimated Total</span>
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">{formatCurrency(displayTotal, currency)}</span>
          </div>
          <p className="px-6 pb-3 text-xs text-slate-400 dark:text-slate-500">
            Final total is calculated by the server and may vary if prices have changed.
          </p>
        </section>

        <section aria-label="Customer information" className="rounded-xl border border-border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Your Information <span className="text-slate-400 font-normal">(optional)</span></h2>
          </div>
          <form onSubmit={handleSubmit} noValidate className="px-6 py-5 space-y-4">
            <div>
              <label htmlFor="customerName" className="label">Name</label>
              <input
                id="customerName"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={200}
                placeholder="Your name (optional)"
                className="input"
                aria-describedby={fieldErrors['customerName'] ? 'name-error' : undefined}
              />
              {fieldErrors['customerName'] && (
                <p id="name-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{fieldErrors['customerName']}</p>
              )}
            </div>

            <div>
              <label htmlFor="customerEmail" className="label">Email</label>
              <input
                id="customerEmail"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                maxLength={254}
                placeholder="your@email.com (optional)"
                className="input"
                aria-describedby={fieldErrors['customerEmail'] ? 'email-error' : undefined}
              />
              {fieldErrors['customerEmail'] && (
                <p id="email-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{fieldErrors['customerEmail']}</p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || items.length === 0}
              className="w-full rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-busy={submitting}
            >
              {submitting ? 'Creating order…' : `Place Order · ${formatCurrency(displayTotal, currency)}`}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function CartEmptyIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
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
function BackIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
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
