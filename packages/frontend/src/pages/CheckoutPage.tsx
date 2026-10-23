import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

export function CheckoutPage() {
  const { user } = useAuth();
  const [storeSlug, setStoreSlug] = useState<string | null>(null);

  useEffect(() => {
    if (user?.storeSlug) {
      setStoreSlug(user.storeSlug);
    } else {
      api.store.get().then((res) => {
        if (res.ok) setStoreSlug(res.data.slug);
      });
    }
  }, [user]);

  const storefrontUrl = storeSlug ? `${window.location.origin}/store/${storeSlug}` : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">QR Checkout</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Share your store link or QR code with customers so they can browse and pay.
        </p>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Your Store Link</h3>
        {storefrontUrl ? (
          <div className="flex items-center gap-3">
            <code className="flex-1 rounded-lg border border-border dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300 break-all">
              {storefrontUrl}
            </code>
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors whitespace-nowrap"
            >
              Open →
            </a>
          </div>
        ) : (
          <div className="h-10 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Share this link with customers so they can browse your products and place orders.
        </p>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">How QR Checkout Works</h3>
        <ol className="space-y-3">
          {[
            {
              step: '1',
              title: 'Customer browses your storefront',
              description: 'Customers visit your store link, browse active products, and add items to their cart.',
            },
            {
              step: '2',
              title: 'Order is created server-side',
              description: 'When checking out, the backend validates products, calculates the total server-side, and creates an order with a unique payment reference.',
            },
            {
              step: '3',
              title: 'QR code displayed for payment',
              description: 'A QR code containing the payment URL is displayed. The customer scans it or taps "Pay with Paystack".',
            },
            {
              step: '4',
              title: 'Payment verified via webhook',
              description: 'After payment, Paystack sends a signed webhook to the backend. The order is only marked as confirmed after cryptographic verification — not from a browser redirect.',
            },
          ].map((item) => (
            <li key={item.step} className="flex gap-4">
              <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/40 text-xs font-bold text-brand-700 dark:text-brand-300">
                {item.step}
              </span>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          <strong>Security:</strong> Payment status is determined exclusively by Paystack server-side verification via
          a signed webhook. Scanning a QR code, opening a payment URL, or being redirected back from Paystack
          does <em>not</em> confirm payment. The order status in your dashboard reflects only verified payments.
        </p>
      </div>
    </div>
  );
}
