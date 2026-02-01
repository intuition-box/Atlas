/**
 * Shared API shapes for server/client boundaries.
 *
 * Schema-first: Zod schemas are the single source of truth for runtime validation.
 * Types can extend the base schema for domain-specific errors.
 *
 * @see CLAUDE.md "Schema-First Pattern"
 */

import { z } from "zod";

// ============================================================================
// Result Type (internal domain code)
// ============================================================================

/** Discriminated union for internal success/failure. No Zod — keep it simple. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ============================================================================
// API Schemas (single source of truth for runtime validation)
// ============================================================================

export const ApiIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  status: z.number(),
  issues: z.array(ApiIssueSchema).optional(),
  meta: z.unknown().optional(),
});

// ============================================================================
// Derived Types
// ============================================================================

export type ApiIssue = z.infer<typeof ApiIssueSchema>;

/**
 * Standard API error shape.
 *
 * Runtime validation uses ApiErrorSchema (base strings/numbers).
 * Generics provide compile-time narrowing for domain-specific errors
 * (e.g., ApiError<"NOT_FOUND", 404>) without affecting runtime behavior.
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

// ============================================================================
// API Envelope
// ============================================================================

/** Standard API envelope for HTTP responses. */
export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export function apiOk<T>(data: T): ApiEnvelope<T> {
  return { ok: true, data };
}

export function apiErr(error: ApiError): ApiEnvelope<never> {
  return { ok: false, error };
}

/** Runtime check for ApiEnvelope shape using Zod. */
export function isApiEnvelope(v: unknown): v is ApiEnvelope<unknown> {
  if (typeof v !== "object" || v === null) return false;
  if (!("ok" in v)) return false;

  if (v.ok === true) return "data" in v;
  if (v.ok === false) return "error" in v && ApiErrorSchema.safeParse(v.error).success;

  return false;
}
