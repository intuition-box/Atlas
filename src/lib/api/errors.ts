import type { ApiEnvelope, ApiError, ApiIssue } from "@/lib/api/shapes";
import { isApiEnvelope } from "@/lib/api/shapes";

/**
 * Shared helpers for turning API failures into UI-friendly error objects.
 *
 * This module is client-safe (no server-only imports).
 */

export type ParsedApiError = {
  /** Flat "field -> message" map for form UIs. */
  fieldErrors: Record<string, string>;
  /** Optional form-level error message (toast/banner). */
  formError?: string;
  /** Optional app-level error code. */
  code?: string;
  /** Optional HTTP status. */
  status?: number;
  /** Optional extra meta payload from the server. */
  meta?: unknown;
};

export type ApiProblemLike = {
  message?: string;
  status?: number;
  code?: string;
  issues?: ApiIssue[];
  meta?: unknown;
};

function pushFieldError(out: ParsedApiError, path: Array<string | number>, message: string) {
  // Heuristic: use the last segment as the field key (matches typical form libs).
  const key = String(path[path.length - 1] ?? "");
  if (!key) return;

  // Preserve first error per field.
  if (!out.fieldErrors[key]) out.fieldErrors[key] = message;
}

export function parseIssues(issues: ApiIssue[] | undefined | null): ParsedApiError {
  const out: ParsedApiError = { fieldErrors: {} };
  if (!issues || !Array.isArray(issues)) return out;

  for (const issue of issues) {
    if (!issue || !Array.isArray(issue.path) || typeof issue.message !== "string") continue;
    pushFieldError(out, issue.path, issue.message);
  }

  return out;
}

export function parseEnvelopeError(env: ApiEnvelope<unknown>): ParsedApiError {
  const out: ParsedApiError = { fieldErrors: {} };

  if (env.ok === true) return out;

  const e = env.error;
  if (typeof e.message === "string" && e.message) out.formError = e.message;
  if (typeof e.code === "string") out.code = e.code;
  if (typeof e.status === "number") out.status = e.status;
  if ("meta" in e) out.meta = (e as any).meta;

  const withIssues = parseIssues(e.issues);
  out.fieldErrors = withIssues.fieldErrors;

  return out;
}

/**
 * Parse a Response that is expected to contain an ApiEnvelope.
 *
 * If parsing fails, returns a safe formError message.
 */
export async function parseApiErrorResponse(res: Response): Promise<ParsedApiError> {
  const out: ParsedApiError = { fieldErrors: {} };

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    out.formError = res.statusText || `Request failed (${res.status})`;
    out.status = res.status;
    return out;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    out.formError = res.statusText || `Request failed (${res.status})`;
    out.status = res.status;
    return out;
  }

  if (!isApiEnvelope(json)) {
    out.formError = "Invalid server response";
    out.status = res.status;
    out.meta = json;
    return out;
  }

  const env = json as ApiEnvelope<unknown>;
  if (env.ok === true) return out;

  const parsed = parseEnvelopeError(env);

  // If server didn't include status, fall back to HTTP.
  if (parsed.status === undefined) parsed.status = res.status;

  return parsed;
}

/**
 * Parse an API problem object.
 *
 * Works with Result-first callers (`result.ok === false ? result.error : ...`) and also with thrown Errors.
 */
export function parseApiProblem(problem: unknown): ParsedApiError {
  const out: ParsedApiError = { fieldErrors: {} };

  const e = problem as ApiProblemLike;

  // Prefer issues when present.
  const issues = e?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const parsed = parseIssues(issues);
    out.fieldErrors = parsed.fieldErrors;
  }

  // Form-level error
  if (typeof e?.message === "string" && e.message) {
    out.formError = e.message;
  }

  if (typeof e?.code === "string") out.code = e.code;
  if (typeof e?.status === "number") out.status = e.status;
  if ("meta" in (e as any)) out.meta = (e as any).meta;

  return out;
}

/**
 * Compatibility wrapper: old code paths may still pass thrown errors.
 * Prefer `parseApiProblem` for Result-first usage.
 */
export const parseApiClientError = parseApiProblem;
