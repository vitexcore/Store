/// <reference types="vite/client" />
/**
 * Type-safe API client for the Store backend.
 *
 * Security notes:
 *  - Never sends credentials stored in localStorage — all auth via HttpOnly cookies.
 *  - CSRF token is fetched from the server and sent as x-csrf-token header.
 *  - Never trusts client-submitted payment status — that comes from the server only.
 */

import type {
  ApiResponse,
  HealthCheckData,
  AuthSession,
  AuthMeResponse,
  Store,
  Product,
  DashboardMetrics,
  SalesAnalytics,
  PaginatedData,
  InventoryAdjustment,
  CheckoutRequest,
  CheckoutResponse,
  PaymentStatusResponse,
  StorefrontProduct,
  StorefrontInfo,
  AssistantResponse,
  InventoryAlerts,
  RestockRecommendations,
} from '@store/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

// ---------------------------------------------------------------------------
// CSRF token management — fetched from server, stored in memory only
// ---------------------------------------------------------------------------
let csrfToken: string | null = null;
let csrfTokenGeneration = 0;
let csrfTokenRequest: { generation: number; promise: Promise<void> } | null = null;

async function fetchCsrfToken(): Promise<string> {
  while (!csrfToken) {
    const generation = csrfTokenGeneration;
    let pending = csrfTokenRequest?.generation === generation ? csrfTokenRequest : null;

    if (!pending) {
      const promise = (async () => {
        const res = await fetch(`${BASE_URL}/api/auth/csrf-token`, { credentials: 'include' });
        if (!res.ok) throw new Error('CSRF token request failed');
        const data = (await res.json()) as ApiResponse<{ token: string }>;
        if (!data.ok || typeof data.data?.token !== 'string' || data.data.token.length === 0) {
          throw new Error('CSRF token response was invalid');
        }
        // A login/logout may invalidate the token while this request is in flight.
        if (csrfTokenGeneration === generation) csrfToken = data.data.token;
      })();
      pending = { generation, promise };
      csrfTokenRequest = pending;
    }

    try {
      await pending.promise;
    } catch (err) {
      if (generation !== csrfTokenGeneration) continue;
      throw err;
    } finally {
      if (csrfTokenRequest === pending) csrfTokenRequest = null;
    }
  }
  return csrfToken;
}

export function resetCsrfToken(): void {
  csrfToken = null;
  csrfTokenGeneration += 1;
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  let requestCsrfToken: string | null = null;

  if (isStateChanging) {
    try {
      requestCsrfToken = await fetchCsrfToken();
    } catch {
      return { ok: false, code: 'CSRF_TOKEN_UNAVAILABLE', message: 'Could not prepare a secure request. Check your connection and try again.' };
    }
  }

  const attempt = async (token: string | null): Promise<ApiResponse<T>> => {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(isStateChanging && token ? { 'x-csrf-token': token } : {}),
          ...options.headers,
        },
        credentials: 'include',
      });

      const data = (await response.json()) as ApiResponse<T>;
      return data;
    } catch {
      return { ok: false, code: 'NETWORK_ERROR', message: 'Could not reach the server. Please check your connection.' };
    }
  };

  const result = await attempt(requestCsrfToken);

  // If the server rejected the CSRF token, clear the stale cached value,
  // fetch a fresh one, and retry exactly once. This handles the case where
  // the cached token was fetched before a session regeneration (e.g. the
  // page was held open across a login) and is now invalid.
  if (!result.ok && (result as { code?: string }).code === 'CSRF_ERROR' && isStateChanging) {
    resetCsrfToken();
    try {
      const refreshedToken = await fetchCsrfToken();
      const retry = await attempt(refreshedToken);
      if (!retry.ok && (retry as { code?: string }).code === 'CSRF_ERROR') {
        return {
          ok: false,
          code: 'CSRF_ERROR',
          message: 'We could not verify this request. No changes were made; please try again.',
        };
      }
      return retry;
    } catch {
      return { ok: false, code: 'CSRF_TOKEN_UNAVAILABLE', message: 'Could not refresh the security token. Your changes were not saved; please try again.' };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Order and transaction row shapes (DB snake_case from API)
// ---------------------------------------------------------------------------
export interface OrderRow {
  id: string;
  store_id: string;
  reference: string;
  status: string;
  total_cents: number;
  currency: string;
  customer_name: string | null;
  customer_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  store_id: string;
  order_id: string;
  order_reference: string;
  status: string;
  amount_cents: number;
  currency: string;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface StockAdjustResult {
  product: Product;
  adjustment: InventoryAdjustment;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------
export const api = {
  health: {
    get: () => apiFetch<HealthCheckData>('/health'),
  },

  auth: {
    getCsrfToken: () => fetchCsrfToken(),
    register: (email: string, password: string, storeName: string) =>
      apiFetch<AuthSession>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, storeName }),
      }),
    login: (email: string, password: string) =>
      apiFetch<AuthSession>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => apiFetch<null>('/api/auth/logout', { method: 'POST' }),
    me: () => apiFetch<AuthMeResponse>('/api/auth/me'),
  },

  store: {
    get: () => apiFetch<Store>('/api/store'),
    update: (data: Partial<{ name: string; description: string | null; contactEmail: string | null; address: string | null; defaultCurrency: string }>) =>
      apiFetch<Store>('/api/store', { method: 'PATCH', body: JSON.stringify(data) }),
  },

  dashboard: {
    get: () => apiFetch<DashboardMetrics>('/api/dashboard'),
  },

  analytics: {
    sales: (params: { preset?: 'today' | '7d' | '30d'; start?: string; end?: string } = {}) => {
      const q = new URLSearchParams();
      if (params.preset) q.set('preset', params.preset);
      if (params.start) q.set('start', params.start);
      if (params.end) q.set('end', params.end);
      const qs = q.toString();
      return apiFetch<SalesAnalytics>(`/api/analytics/sales${qs ? `?${qs}` : ''}`);
    },
  },

  assistant: {
    query: (params: {
      question: string;
      preset?: 'today' | '7d' | '30d';
      start?: string;
      end?: string;
    }) =>
      apiFetch<AssistantResponse>('/api/assistant/query', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  },

  products: {
    list: (params: { page?: number; pageSize?: number; search?: string; status?: string } = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.pageSize) q.set('pageSize', String(params.pageSize));
      if (params.search) q.set('search', params.search);
      if (params.status) q.set('status', params.status);
      const qs = q.toString();
      return apiFetch<PaginatedData<Product>>(`/api/products${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => apiFetch<Product>(`/api/products/${id}`),
    create: (data: {
      name: string; description?: string; price_cents: number;
      currency?: string; status?: string; stock_quantity?: number; low_stock_threshold?: number;
      idempotency_key?: string;
    }) => apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{
      name: string; description: string; price_cents: number;
      currency: string; status: string; low_stock_threshold: number;
    }>) => apiFetch<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    archive: (id: string) =>
      apiFetch<Product>(`/api/products/${id}/archive`, { method: 'PATCH', body: JSON.stringify({}) }),
    remove: (id: string) =>
      apiFetch<null>(`/api/products/${id}`, { method: 'DELETE' }),
  },

  inventory: {
    summary: (params: { page?: number; pageSize?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.pageSize) q.set('pageSize', String(params.pageSize));
      const qs = q.toString();
      return apiFetch<PaginatedData<Product>>(`/api/inventory${qs ? `?${qs}` : ''}`);
    },
    adjust: (productId: string, delta: number, reason: string) =>
      apiFetch<StockAdjustResult>(`/api/inventory/${productId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason }),
      }),
    alerts: () => apiFetch<InventoryAlerts>('/api/inventory/alerts'),
    restockRecommendations: () =>
      apiFetch<RestockRecommendations>('/api/inventory/restock-recommendations'),
  },

  orders: {
    list: (params: { page?: number; pageSize?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.pageSize) q.set('pageSize', String(params.pageSize));
      const qs = q.toString();
      return apiFetch<{ items: OrderRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(`/api/orders${qs ? `?${qs}` : ''}`);
    },
  },

  transactions: {
    list: (params: { page?: number; pageSize?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.pageSize) q.set('pageSize', String(params.pageSize));
      const qs = q.toString();
      return apiFetch<{ items: TransactionRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(`/api/transactions${qs ? `?${qs}` : ''}`);
    },
  },

  storefront: {
    getStore: (storeSlug: string) =>
      apiFetch<StorefrontInfo>(`/api/storefront/${encodeURIComponent(storeSlug)}`),
    getProducts: (storeSlug: string, params: { page?: number; pageSize?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.pageSize) q.set('pageSize', String(params.pageSize));
      const qs = q.toString();
      return apiFetch<{
        store: StorefrontInfo;
        products: StorefrontProduct[];
        meta: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/storefront/${encodeURIComponent(storeSlug)}/products${qs ? `?${qs}` : ''}`);
    },
  },

  checkout: {
    /** Create an order from the buyer cart. Public; CSRF is required. */
    createOrder: (data: CheckoutRequest) =>
      apiFetch<CheckoutResponse>('/api/checkout/cart', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** Initialize Paystack for an existing payment token. Public; CSRF is required. */
    initializePaystack: (paymentToken: string) =>
      apiFetch<{ authorizationUrl: string; reference: string }>('/api/checkout/paystack/initialize', {
        method: 'POST',
        body: JSON.stringify({ paymentToken }),
      }),
    /** Get payment status by opaque token. Public — no auth required. */
    getPaymentStatus: (token: string) =>
      apiFetch<PaymentStatusResponse>(`/api/checkout/status/${encodeURIComponent(token)}`),
  },
};
