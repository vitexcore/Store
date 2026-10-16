// Standardised API envelope used by every backend endpoint.
// Keeps success/error shapes consistent so the frontend can rely on a single pattern.

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  /** Human-readable message safe to display in the UI. Never includes stack traces or secrets. */
  message: string;
  /** Machine-readable error code, e.g. "VALIDATION_ERROR", "NOT_FOUND" */
  code: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface HealthCheckData {
  status: 'ok';
  timestamp: string;
  version: string;
  services: {
    database: 'ok' | 'error' | 'unknown';
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedData<T> {
  items: T[];
  meta: PaginationMeta;
}
