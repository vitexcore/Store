/// <reference types="vite/client" />
/**
 * Type-safe API client for the Store backend.
 *
 * Security notes:
 *  - Never sends credentials (cookies, tokens) stored in localStorage.
 *  - Auth credentials will be sent as HttpOnly cookies (Day 2).
 *  - Never trusts client-submitted payment status — that comes from the server only.
 *  - Response bodies are treated as untrusted data and validated before use.
 */

import type { ApiResponse, HealthCheckData } from '@store/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      // Credentials sent as cookies — NEVER as Authorization header with localStorage token
      credentials: 'include',
    });

    const data = (await response.json()) as ApiResponse<T>;
    return data;
  } catch (err) {
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
