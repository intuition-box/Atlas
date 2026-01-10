/**
 * Shared shapes for server/client boundaries.
 *
 * Keep this file:
 * - framework-agnostic (no Next.js imports)
 * - runtime-light (types first)
 * - dependency-free (so it can be imported from anywhere)
 */

/** A simple, typed success/failure result used inside server-only domain code. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** A standard error payload shape for boundaries (API responses, adapters). */
export type Problem<Code extends string = string, Status extends number = number> = {
  code: Code;
  message: string;
  status: Status;
};

/**
 * An issue points to a particular input path (e.g. a field) and explains the problem.
 *
 * We use `(string | number)[]` so it can represent nested objects/arrays.
 */
export type ApiIssue = {
  path: Array<string | number>;
  message: string;
};

/**
 * API error shape used in envelopes.
 *
 * - `issues` is optional and used for validation/form errors.
 * - `meta` is optional for extra safe-to-expose context (timestamps, ids, etc.).
 */
export type ApiError<Code extends string = string, Status extends number = number, Meta = unknown> = Problem<Code, Status> & {
  issues?: ApiIssue[];
  meta?: Meta;
};

/**
 * Standard API envelope.
 *
 * Use this as the only response shape for JSON API routes.
 */
export type ApiEnvelope<T, Code extends string = string, Status extends number = number, Meta = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError<Code, Status, Meta> };

export function okEnvelope<T>(data: T): ApiEnvelope<T> {
  return { ok: true, data };
}

export function errEnvelope<Code extends string, Status extends number, Meta = unknown>(
  error: ApiError<Code, Status, Meta>,
): ApiEnvelope<never, Code, Status, Meta> {
  return { ok: false, error };
}

/** Runtime check for "looks like" an ApiEnvelope. Keep intentionally loose. */
export function isApiEnvelope(v: unknown): v is ApiEnvelope<unknown> {
  if (!v || typeof v !== "object") return false;
  const anyV = v as any;

  if (typeof anyV.ok !== "boolean") return false;

  if (anyV.ok === true) {
    return "data" in anyV;
  }

  if (anyV.ok !== false) return false;

  const e = anyV.error;
  if (!e || typeof e !== "object") return false;

  // Core fields required by our ApiError shape.
  if (typeof (e as any).code !== "string") return false;
  if (typeof (e as any).message !== "string") return false;
  if (typeof (e as any).status !== "number") return false;

  return true;
}