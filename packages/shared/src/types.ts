// ---------------------------------------------------------------------------
// Domain entity shapes shared between backend and frontend.
// These are plain data shapes, NOT ORM models. Keep them free of DB-specific types.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'merchant' | 'staff';

export type ProductStatus = 'active' | 'draft' | 'archived';

export type OrderStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded';

export type PaymentStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Users / Stores
// ---------------------------------------------------------------------------

export interface Store {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  contactEmail: string | null;
  address: string | null;
  defaultCurrency: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardMetrics {
  totalRevenueCents: number;
  currency: string;
  confirmedOrderCount: number;
  activeProductCount: number;
  lowStockProductCount: number;
  recentOrders: RecentOrderSummary[];
}

export interface RecentOrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  customerName: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Sales analytics
// ---------------------------------------------------------------------------

export type SalesAnalyticsPreset = 'today' | '7d' | '30d' | 'custom';

export interface SalesAnalyticsRange {
  /** Inclusive first calendar day (YYYY-MM-DD) in the analytics timezone. */
  start: string;
  /** Inclusive last calendar day (YYYY-MM-DD) in the analytics timezone. */
  end: string;
  preset: SalesAnalyticsPreset;
  /** IANA timezone used for every date boundary in this response. */
  timezone: string;
  /** Number of calendar days in the selected range. */
  days: number;
}

export interface SalesAnalyticsComparison {
  /** Inclusive first day of the immediately preceding equivalent period. */
  start: string;
  /** Inclusive last day of the immediately preceding equivalent period. */
  end: string;
  revenueCents: number;
  completedOrderCount: number;
  averageOrderValueCents: number;
  revenueChangeCents: number;
  /** Percentage change rounded to one decimal. Null means there is no prior baseline. */
  revenueChangePercent: number | null;
  orderCountChange: number;
  /** Percentage change rounded to one decimal. Null means there is no prior baseline. */
  orderCountChangePercent: number | null;
}

export interface SalesDailyPoint {
  /** Calendar day (YYYY-MM-DD) in the analytics timezone. */
  date: string;
  revenueCents: number;
  orderCount: number;
}

export interface SalesProductPerformance {
  /** Null when the product record no longer exists; the name is the order snapshot. */
  productId: string | null;
  name: string;
  quantitySold: number;
  revenueCents: number;
  orderCount: number;
}

export interface SalesAnalytics {
  currency: string;
  range: SalesAnalyticsRange;
  comparison: SalesAnalyticsComparison;
  revenueCents: number;
  completedOrderCount: number;
  averageOrderValueCents: number;
  daily: SalesDailyPoint[];
  topProducts: SalesProductPerformance[];
  /** Lowest quantities sold among products that sold at least once in the range. */
  slowestProducts: SalesProductPerformance[];
  limitations: string[];
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  storeId: string | null;
  createdAt: string;
}

// Password, tokens, and secret fields are NEVER included in these shapes.
// They are stripped server-side before sending to any client.

// ---------------------------------------------------------------------------
// Authentication & Session
// ---------------------------------------------------------------------------

/** Safe user shape returned by auth endpoints — never includes password_hash. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  storeId: string | null;
  storeName: string | null;
  storeSlug: string | null;
  createdAt: string;
}

/** Response from POST /api/auth/register and POST /api/auth/login */
export interface AuthSession {
  user: AuthUser;
}

/** Response from GET /api/auth/me — returns null user when unauthenticated */
export interface AuthMeResponse {
  user: AuthUser | null;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  storeId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  status: ProductStatus;
  imageUrl: string | null;
  stockQuantity: number;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface InventoryAdjustment {
  id: string;
  storeId: string;
  productId: string;
  userId: string;
  delta: number;
  reason: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface Order {
  id: string;
  storeId: string;
  reference: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Transactions / Payments
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  storeId: string;
  orderId: string;
  orderReference: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  /** Expiry for the payment request. Never trust as proof of payment on the client. */
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Cart (client-side state — NEVER trusted for pricing on the backend)
// ---------------------------------------------------------------------------

/** A single item in the customer cart. Quantities only — prices are resolved server-side. */
export interface CartItem {
  productId: string;
  quantity: number;
  /** Display snapshot only — not sent to backend for total calculation. */
  name: string;
  /** Display snapshot only — authoritative price is fetched from DB on order creation. */
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  maxStock: number;
}

// ---------------------------------------------------------------------------
// Checkout request/response
// ---------------------------------------------------------------------------

/** Payload sent to POST /api/checkout/cart */
export interface CheckoutRequest {
  /** Opaque idempotency key (UUID v4 generated client-side) */
  idempotencyKey: string;
  /** Store slug — validated server-side */
  storeSlug: string;
  /** Items: only productId + quantity; pricing is server-side */
  items: Array<{ productId: string; quantity: number }>;
  customerName?: string;
  customerEmail?: string;
}

/** Response from POST /api/checkout/cart */
export interface CheckoutResponse {
  orderId: string;
  orderReference: string;
  /** Opaque payment token — used to poll status and build QR payload */
  paymentToken: string;
  amountCents: number;
  currency: string;
  expiresAt: string;
}

/** Response from GET /api/checkout/status/:token (public, no auth required) */
export interface PaymentStatusResponse {
  paymentToken: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  orderReference: string;
  storeName: string;
  expiresAt: string | null;
  paidAt: string | null;
  /** Authorization URL from Paystack (safe to share; only used to redirect to provider) */
  paystackAuthorizationUrl: string | null;
}

/** Response from POST /api/checkout/paystack/initialize */
export interface PaystackInitializeResponse {
  authorizationUrl: string;
  reference: string;
}

// ---------------------------------------------------------------------------
// Storefront product (public — subset of Product, no internal fields)
// ---------------------------------------------------------------------------

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  stockQuantity: number;
  /** True if product is active and in stock */
  available: boolean;
}

export interface StorefrontInfo {
  name: string;
  slug: string;
  description: string | null;
  defaultCurrency: string;
}
