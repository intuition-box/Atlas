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
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v.success !== "boolean") return false;

  if (v.success === true) {
    // Success branch must have data and must not have an error payload.
    if (!("data" in v)) return false;
    if ("error" in v) return false;
    return true;
  }

  // Failure branch must have error and must not have data.
  if (!("error" in v)) return false;
  if ("data" in v) return false;

  const err = v.error;
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;

  return typeof e.code === "number" && typeof e.message === "string";
}
