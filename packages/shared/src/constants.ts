// ---------------------------------------------------------------------------
// Application-wide constants shared between frontend and backend.
// ---------------------------------------------------------------------------

export const APP_NAME = 'Store' as const;
export const APP_VERSION = '0.0.1' as const;

/** Supported currency codes. Extended as needed. */
export const SUPPORTED_CURRENCIES = ['GBP', 'USD', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Maximum lengths for user-supplied text fields. Enforced on both client and server. */
export const MAX_LENGTHS = {
  storeName: 120,
  productName: 200,
  productDescription: 2000,
  customerName: 200,
  customerEmail: 254,
  orderReference: 64,
} as const;

/** Default pagination page size. */
export const DEFAULT_PAGE_SIZE = 20 as const;
export const MAX_PAGE_SIZE = 200 as const;
