/**
 * API error payload used inside the ApiResponse error branch.
 */
export type ApiError = {
  /** Numeric HTTP-style code for the error (e.g., 400, 401, 429, 500). */
  code: number;
  /** Human-friendly error message safe to show in the UI. */
  message: string;
  /** Optional machine-friendly details for debugging (never secrets). */
  details?: unknown;
};

/**
 * Canonical API response envelope used across server and client.
 * Always return this shape from route handlers.
 *
 * Usage:
 *  - On success: { success: true, data }
 *  - On failure: { success: false, error: { code, message, details? } }
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

/**
 * Runtime type guard to validate a parsed JSON value matches ApiResponse<T>.
 * Prefer this when consuming untyped JSON at runtime.
 */
export function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.success !== 'boolean') return false;
  if (v.success === true) {
    return 'data' in v;
  }
  if (v.success === false) {
    const err = v.error as Record<string, unknown> | undefined;
    return !!err && typeof err.message === 'string' && typeof err.code === 'number';
  }
  return false;
}
