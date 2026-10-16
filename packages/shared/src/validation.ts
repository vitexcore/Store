// ---------------------------------------------------------------------------
// Lightweight validation utilities shared between front and back.
// These are pure functions with no runtime dependencies — safe to bundle on both sides.
// ---------------------------------------------------------------------------

/** Checks whether a string is a valid UUID v4. */
export function isUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Checks whether a value is a non-empty string within an optional length bound. */
export function isNonEmptyString(value: unknown, maxLength = 1000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

/** Checks whether a value is a positive integer (used for prices in cents, quantities, etc.). */
export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Checks whether a value is a non-negative integer (allows zero). */
export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Checks whether a string is a syntactically valid email address. */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // RFC-5321 simplified; intentionally conservative
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(value);
}

/** Checks whether a value is one of an allowed set of strings. */
export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Clamps a number to a safe pagination range. */
export function clampPage(raw: unknown, max = 200): { page: number; pageSize: number } {
  const page = typeof raw === 'number' && raw >= 1 ? Math.floor(raw) : 1;
  const pageSize = max;
  return { page, pageSize };
}
