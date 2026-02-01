/**
 * Shared shapes for server/client boundaries.
 *
 * Keep this file:
 * - framework-agnostic (no Next.js imports)
 * - runtime-light (types first)
 * - dependency-free (so it can be imported from anywhere)
 */

// ============================================================================
// Result Type (internal domain code)
// ============================================================================

/** A simple, typed success/failure result for internal code. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ============================================================================
// API Types (HTTP boundaries)
// ============================================================================

/** Validation issue pointing to a specific field. */
export type ApiIssue = {
  path: Array<string | number>;
  message: string;
};

/**
 * Standard API error shape.
 *
 * Generics allow typed domain errors (e.g., ApiError<"NOT_FOUND", 404>)
 * but default to simple strings for general use.
 */
export type ApiError<
  Code extends string = string,
  Status extends number = number,
  Meta = unknown,
> = {
  code: Code;
  message: string;
  status: Status;
  issues?: ApiIssue[];
  meta?: Meta;
};

/** Standard API envelope for HTTP responses. */
export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export function okEnvelope<T>(data: T): ApiEnvelope<T> {
  return { ok: true, data };
}

export function errEnvelope(error: ApiError): ApiEnvelope<never> {
  return { ok: false, error };
}

/** Runtime check for ApiEnvelope shape. */
export function isApiEnvelope(v: unknown): v is ApiEnvelope<unknown> {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;

  if (typeof obj.ok !== "boolean") return false;

  if (obj.ok === true) {
    return "data" in obj;
  }

  const e = obj.error;
  if (!e || typeof e !== "object") return false;

  const error = e as Record<string, unknown>;
  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.status === "number"
  );
}
