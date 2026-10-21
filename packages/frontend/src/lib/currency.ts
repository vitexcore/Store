/**
 * Currency formatting utilities for the Store frontend.
 *
 * All monetary values are stored and received as integer minor units (kobo for NGN).
 * Never perform arithmetic on formatted strings — always work with minor units.
 */

/**
 * Format an integer minor-unit amount using the en-NG locale and specified currency.
 * Defaults to NGN if currency is not provided.
 *
 * @example formatCurrency(150000, 'NGN') → "₦1,500.00"
 * @example formatCurrency(150000, 'GBP') → "£1,500.00"
 */
export function formatCurrency(minorUnits: number, currency = 'NGN'): string {
  // Use en-NG locale for Nigerian naira; fall back gracefully for other currencies
  const locale = currency === 'NGN' ? 'en-NG' : 'en-GB';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Format a date string for display.
 */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Format a date string with time for display.
 */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
