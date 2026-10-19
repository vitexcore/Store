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
  PaginatedData,
  InventoryAdjustment,
} from '@store/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

// ---------------------------------------------------------------------------
// CSRF token management — fetched from server, stored in memory only
// ---------------------------------------------------------------------------
let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<void> {
  if (csrfToken) return;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/csrf-token`, { credentials: 'include' });
    const data = (await res.json()) as ApiResponse<{ token: string }>;
    if (data.ok) csrfToken = data.data.token;
  } catch {
    // Will retry on next state-changing request
  }
}

function getCsrfHeader(): Record<string, string> {
  return csrfToken ? { 'x-csrf-token': csrfToken } : {};
}

export function resetCsrfToken(): void {
  csrfToken = null;
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isStateChanging) await fetchCsrfToken();

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(isStateChanging ? getCsrfHeader() : {}),
        ...options.headers,
      },
      credentials: 'include',
    });

    const data = (await response.json()) as ApiResponse<T>;

    if (!data.ok && (data as { code?: string }).code === 'CSRF_ERROR') {
      resetCsrfToken();
    }

    return data;
  } catch {
    return { ok: false, code: 'NETWORK_ERROR', message: 'Could not reach the server. Please check your connection.' };
  }
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
    }) => apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{
      name: string; description: string; price_cents: number;
      currency: string; status: string; low_stock_threshold: number;
    }>) => apiFetch<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    archive: (id: string) =>
      apiFetch<Product>(`/api/products/${id}/archive`, { method: 'PATCH', body: JSON.stringify({}) }),
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
};
