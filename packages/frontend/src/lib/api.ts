/// <reference types="vite/client" />
/**
 * Type-safe API client for the Store backend.
 *
 * Security notes:
 *  - Never sends credentials (cookies, tokens) stored in localStorage.
 *  - Auth credentials are sent as HttpOnly cookies (credentials: 'include').
 *  - CSRF token is fetched from the server and sent in x-csrf-token header for
 *    state-changing requests (POST, PUT, PATCH, DELETE).
 *  - Never trusts client-submitted payment status — that comes from the server only.
 *  - Response bodies are treated as untrusted data and validated before use.
 */

import type { ApiResponse, HealthCheckData, AuthSession, AuthMeResponse } from '@store/shared';

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
    if (data.ok) {
      csrfToken = data.data.token;
    }
  } catch {
    // Token fetch will retry on next state-changing request
  }
}

function getCsrfHeader(): Record<string, string> {
  return csrfToken ? { 'x-csrf-token': csrfToken } : {};
}

/** Reset the CSRF token — called on logout or when a CSRF error is received. */
export function resetCsrfToken(): void {
  csrfToken = null;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  // For state-changing methods, ensure we have a CSRF token
  const method = (options.method ?? 'GET').toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isStateChanging) {
    await fetchCsrfToken();
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(isStateChanging ? getCsrfHeader() : {}),
        ...options.headers,
      },
      // Credentials sent as cookies — NEVER as Authorization header with localStorage token
      credentials: 'include',
    });

    const data = (await response.json()) as ApiResponse<T>;

    // If we got a CSRF error, reset the token so it's re-fetched next time
    if (!data.ok && data.code === 'CSRF_ERROR') {
      resetCsrfToken();
    }

    return data;
  } catch {
    // Network error — return a safe error shape
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Please check your connection.',
    };
  }
}

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
    logout: () =>
      apiFetch<null>('/api/auth/logout', { method: 'POST' }),
    me: () =>
      apiFetch<AuthMeResponse>('/api/auth/me'),
  },

  dashboard: {
    get: () => apiFetch<{ message: string }>('/api/dashboard'),
  },

  products: {
    list: () => apiFetch<{ message: string }>('/api/products'),
  },

  orders: {
    list: () => apiFetch<{ message: string }>('/api/orders'),
  },

  transactions: {
    list: () => apiFetch<{ message: string }>('/api/transactions'),
  },
};
