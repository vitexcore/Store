/**
 * Currency utilities for Store backend.
 *
 * Financial values are stored as integer minor units (kobo for NGN, pence for GBP, cents for USD/EUR).
 * Conversions happen ONCE at the API boundary; never double-convert.
 *
 * Security notes:
 *  - Never accept client-supplied totals — always calculate server-side.
 *  - nairaToKobos and kobosToNaira are used only for display and Paystack API calls.
 *  - Paystack requires amounts in kobo (integer) for NGN.
 */

/**
 * Format an integer kobo amount as a human-readable NGN string.
 * Uses the en-NG locale so thousands separators match Nigerian conventions.
 *
 * @example formatNGN(150000) → "₦1,500.00"
 */
export function formatNGN(kobos: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kobos / 100);
}

/**
 * Format an integer minor-unit amount for any supported currency.
 * Falls back to NGN formatting for unknown currencies.
 */
export function formatCurrency(minorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minorUnits / 100);
  } catch {
    // Unknown currency — render plain number
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Convert a whole naira amount (number) to kobo (integer minor units).
 * Rounds to nearest integer to avoid floating-point drift.
 *
 * @example nairaToKobos(1500) → 150000
 */
export function nairaToKobos(naira: number): number {
  return Math.round(naira * 100);
}

/**
 * Convert kobo (integer minor units) to naira (decimal).
 * For display purposes only — do not use as financial source of truth.
 *
 * @example kobosToNaira(150000) → 1500
 */
export function kobosToNaira(kobos: number): number {
  return kobos / 100;
}

/**
 * Validate that an integer minor-unit amount is a positive integer.
 * Used before sending to Paystack to guard against invalid values.
 */
export function isValidAmountKobos(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
