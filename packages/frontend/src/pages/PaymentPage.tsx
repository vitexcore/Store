import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api.js';
import { formatCurrency, formatDateTime } from '../lib/currency.js';
import type { PaymentStatusResponse } from '@store/shared';

const POLL_INTERVAL_MS = 3_000;
const SLOW_POLL_MS = 15_000;
const STOP_POLL_TIMEOUT_MS = 10 * 60 * 1000;

type TerminalStatus = 'paid' | 'failed' | 'expired' | 'cancelled';

function isTerminal(status: string): status is TerminalStatus {
  return ['paid', 'failed', 'expired', 'cancelled'].includes(status);
}

export function PaymentPage() {
  const { token } = useParams<{ token: string }>();
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef(Date.now());
  const paymentUrl = `${window.location.origin}/payment/${token ?? ''}`;

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    const res = await api.checkout.getPaymentStatus(token);
    if (res.ok) {
      setPaymentStatus(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
    if (loading) setLoading(false);
  }, [token, loading]);

  const scheduleNextPoll = useCallback((currentStatus: string) => {
    if (isTerminal(currentStatus)) return;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    const elapsed = Date.now() - startTimeRef.current;
    if (elapsed > STOP_POLL_TIMEOUT_MS) return;
    const interval = elapsed > 2 * 60 * 1000 ? SLOW_POLL_MS : POLL_INTERVAL_MS;
    pollTimerRef.current = setTimeout(async () => {
      await fetchStatus();
      if (paymentStatus && !isTerminal(paymentStatus.status)) {
        scheduleNextPoll(paymentStatus.status);
      }
    }, interval);
  }, [fetchStatus, paymentStatus]);

  useEffect(() => {
    fetchStatus();
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!paymentStatus) return;
    if (!isTerminal(paymentStatus.status)) {
      scheduleNextPoll(paymentStatus.status);
    }
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentStatus?.status]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-4" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading payment details…</p>
        </div>
      </div>
    );
  }

  if (error && !paymentStatus) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="rounded-xl border border-border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-8 max-w-md w-full text-center">
          <ErrorIcon className="mx-auto h-12 w-12 text-red-400 mb-4" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Payment not found</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{error}</p>
          <Link to="/" className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  const status = paymentStatus?.status ?? 'awaiting_payment';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-border dark:border-slate-700 shadow-sm">
        <div className="mx-auto max-w-lg px-4 py-4 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
            <StoreLogo />
          </div>
          <div>
            {paymentStatus && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{paymentStatus.storeName}</p>
            )}
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Payment</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-8 space-y-6">
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex gap-3 items-start">
          <AlertIcon className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <strong>Paystack test mode.</strong> No real funds will be transferred.
          </p>
        </div>

        <StatusBanner status={status} />

        {paymentStatus && (
          <>
            <div className="rounded-xl border border-border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-6 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">Amount to pay</p>
              <p className="text-4xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {formatCurrency(paymentStatus.amountCents, paymentStatus.currency)}
              </p>
              <p className="mt-2 font-mono text-xs text-slate-400 dark:text-slate-500">
                Ref: {paymentStatus.orderReference}
              </p>
              {paymentStatus.expiresAt && status !== 'paid' && (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Expires: {formatDateTime(paymentStatus.expiresAt)}
                </p>
              )}
              {paymentStatus.paidAt && status === 'paid' && (
                <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                  Paid: {formatDateTime(paymentStatus.paidAt)}
                </p>
              )}
            </div>

            {(status === 'awaiting_payment' || status === 'pending') && (
              <div className="rounded-xl border border-border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-6 flex flex-col items-center gap-4">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Scan to pay with Paystack</p>
                <div className="rounded-xl border-2 border-border dark:border-slate-600 p-3 bg-white" role="img" aria-label="Payment QR code">
                  <QRCodeSVG value={paymentUrl} size={200} level="M" includeMargin={false} />
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-xs">
                  Scan this code with your phone camera, or tap the button below to pay directly.
                </p>
                {paymentStatus.paystackAuthorizationUrl ? (
                  <a
                    href={paymentStatus.paystackAuthorizationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white text-center hover:bg-brand-700 transition-colors"
                  >
                    Pay with Paystack →
                  </a>
                ) : null}
                <PollingIndicator />
              </div>
            )}

            {status === 'paid' && (
              <div className="rounded-xl border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/20 p-6 text-center">
                <CheckIcon className="mx-auto h-12 w-12 text-green-500 dark:text-green-400 mb-3" />
                <h2 className="text-lg font-bold text-green-800 dark:text-green-300">Payment Confirmed</h2>
                <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                  Your order {paymentStatus.orderReference} has been confirmed.
                </p>
                <p className="text-xs text-green-600 dark:text-green-500 mt-2">
                  Status verified by Paystack webhook — not by a browser redirect.
                </p>
              </div>
            )}

            {(status === 'failed' || status === 'expired' || status === 'cancelled') && (
              <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 p-6 text-center">
                <ErrorIcon className="mx-auto h-10 w-10 text-red-400 dark:text-red-500 mb-3" />
                <h2 className="text-lg font-bold text-red-800 dark:text-red-300">
                  {status === 'expired' ? 'Payment Expired' : status === 'cancelled' ? 'Payment Cancelled' : 'Payment Failed'}
                </h2>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                  {status === 'expired'
                    ? 'This payment request has expired. Please start a new order.'
                    : 'This payment was not completed. Please try again.'}
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StatusBanner({ status }: { status: string }) {
  const configs: Record<string, { label: string; className: string }> = {
    awaiting_payment: { label: '⏳ Awaiting payment', className: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300' },
    pending: { label: '⏳ Pending', className: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300' },
    paid: { label: '✓ Payment confirmed', className: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 text-green-800 dark:text-green-300' },
    failed: { label: '✗ Payment failed', className: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-300' },
    expired: { label: '⌛ Expired', className: 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-400' },
    cancelled: { label: '✗ Cancelled', className: 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-400' },
  };
  const c = configs[status] ?? configs['pending']!;
  return (
    <div className={`rounded-lg border px-4 py-2 text-sm font-medium text-center ${c.className}`}>
      {c.label}
    </div>
  );
}

function PollingIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500" aria-live="polite" aria-label="Checking payment status">
      <span className="flex h-2 w-2 animate-pulse rounded-full bg-brand-400" />
      Checking payment status…
    </div>
  );
}
function StoreLogo() {
  return <svg viewBox="0 0 24 24" fill="white" className="h-5 w-5" aria-hidden="true"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
}
function CheckIcon({ className }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function ErrorIcon({ className }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function AlertIcon({ className }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
}
