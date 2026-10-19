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
