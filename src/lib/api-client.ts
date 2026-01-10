"use client";

import type { ApiEnvelope, ApiError, ApiIssue, Result } from "@/lib/api-shapes";
import { err, isApiEnvelope, ok } from "@/lib/api-shapes";

/**
 * Client-safe API client for JSON API routes.
 *
 * Canonical JSON envelope (see `src/lib/api-shapes.ts`):
 * - { ok: true, data }
 * - { ok: false, error: { code, message, status, issues?, meta? } }
 *
 * Convention (AGENTS.md): use GET and POST only.
 */

export type ApiClientErrorCode =
  | "CLIENT_NETWORK_ERROR"
  | "CLIENT_REQUEST_ABORTED"
  | "CLIENT_REQUEST_TIMEOUT"
  | "CLIENT_INVALID_RESPONSE"
  | "CLIENT_NON_JSON_RESPONSE";

export type ApiClientError = ApiError<ApiClientErrorCode, number, unknown>;

export type ApiRequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, QueryValue> | URLSearchParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;

  /** If set, sent as If-Match for optimistic concurrency control. */
  ifMatch?: string;

  /** If set, sent as Idempotency-Key for safe request retries. */
  idempotencyKey?: string;

  /** Override automatic CSRF header attachment. Defaults to true for POST. */
  csrf?: boolean;

  /** Retry once after CSRF refresh on CSRF failure. Defaults to true. */
  retryOnCsrfFailure?: boolean;

  /** Request timeout in milliseconds. Aborts the request if exceeded. */
  timeoutMs?: number;

  /** @internal Used to prevent infinite retry loops. Do not set manually. */
  _retryCount?: number;
};

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

type CsrfResponse = { token: string };

let csrfToken = "";
let csrfReady = false;
let csrfInFlight: Promise<string> | null = null;

/**
 * Resets the cached CSRF token, forcing a fresh fetch on next request.
 * Useful for testing or handling token invalidation.
 */
export function resetCsrf(): void {
  csrfToken = "";
  csrfReady = false;
  csrfInFlight = null;
}

function shouldAttachCsrf(method: "GET" | "POST", override?: boolean): boolean {
  if (override === false) return false;
  if (override === true) return true;
  return method === "POST";
}

/**
 * Fetches CSRF token with race condition protection.
 * Multiple concurrent calls will reuse the same in-flight request.
 */
async function getCsrfToken(): Promise<string> {
  if (csrfReady) return csrfToken;
  if (csrfInFlight) return csrfInFlight;

  csrfInFlight = (async () => {
    try {
      const r = await fetch("/api/security/csrf", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!r.ok) {
        csrfToken = "";
        csrfReady = true;
        return csrfToken;
      }

      const json: unknown = await r.json().catch(() => null);
      if (isApiEnvelope(json)) {
        const env = json as ApiEnvelope<CsrfResponse>;
        if (env.ok === true) {
          csrfToken = env.data?.token ?? "";
        } else {
          csrfToken = "";
        }
      } else {
        csrfToken = "";
      }

      csrfReady = true;
      return csrfToken;
    } catch {
      csrfToken = "";
      csrfReady = true;
      return csrfToken;
    } finally {
      csrfInFlight = null;
    }
  })();

  return csrfInFlight;
}

/**
 * Builds query string from object or URLSearchParams.
 * Handles arrays by appending multiple values with the same key.
 * Filters out null and undefined values.
 */
function buildQuery(q?: Record<string, QueryValue> | URLSearchParams): string {
  if (!q) return "";
  if (q instanceof URLSearchParams) {
    const s = q.toString();
    return s ? `?${s}` : "";
  }

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item == null) continue;
        sp.append(k, String(item));
      }
    } else {
      sp.append(k, String(v));
    }
  }

  const s = sp.toString();
  return s ? `?${s}` : "";
}

function nonJsonError(status: number, contentType: string | null): ApiClientError {
  return {
    code: "CLIENT_NON_JSON_RESPONSE",
    message: "Invalid server response",
    status,
    meta: { contentType },
  };
}

function invalidEnvelopeError(status: number, meta?: unknown): ApiClientError {
  return {
    code: "CLIENT_INVALID_RESPONSE",
    message: "Invalid server response",
    status,
    meta,
  };
}

function networkError(aborted: boolean = false, timeout: boolean = false): ApiClientError {
  if (timeout) {
    return {
      code: "CLIENT_REQUEST_TIMEOUT",
      message: "Request timeout",
      status: 0,
    };
  }
  if (aborted) {
    return {
      code: "CLIENT_REQUEST_ABORTED",
      message: "Request cancelled",
      status: 0,
    };
  }
  return {
    code: "CLIENT_NETWORK_ERROR",
    message: "Network error",
    status: 0,
  };
}

function isCsrfProblem(e: { status: number; code?: string }): boolean {
  return e.status === 419 || e.code === "CSRF_FAILED";
}

/**
 * Parses a JSON response and validates the canonical API envelope shape.
 */
async function parseEnvelope<T>(r: Response): Promise<Result<T, ApiError<string, number, unknown> | ApiClientError>> {
  const ct = r.headers.get("content-type");
  if (!ct || !ct.toLowerCase().includes("application/json")) {
    try {
      await r.text();
    } catch {
      // ignore
    }
    return err(nonJsonError(r.status, ct));
  }

  let json: unknown;
  try {
    json = await r.json();
  } catch {
    return err(invalidEnvelopeError(r.status));
  }

  if (!isApiEnvelope(json)) {
    return err(invalidEnvelopeError(r.status, json));
  }

  const env = json as ApiEnvelope<T>;

  if (env.ok === true) {
    return ok(env.data);
  }

  // Error envelope
  const error = env.error as ApiError<string, number, unknown>;

  return err(error);
}

/**
 * Makes an API request and returns a Result for explicit handling.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Result<T, ApiError<string, number, unknown> | ApiClientError>> {
  const retryCount = options._retryCount ?? 0;
  const method: "GET" | "POST" = options.method ?? "GET";
  const retryOnCsrfFailure = options.retryOnCsrfFailure ?? true;

  const url = `${path}${buildQuery(options.query)}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers ?? {}),
  };

  if (options.ifMatch) headers["If-Match"] = options.ifMatch;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  // Setup abort/timeout handling
  const controller = options.timeoutMs ? new AbortController() : undefined;
  let timedOut = false;

  let abortListener: (() => void) | null = null;
  if (controller && options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      abortListener = () => controller.abort();
      options.signal.addEventListener("abort", abortListener, { once: true });
    }
  }

  const timeoutId =
    controller && options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, options.timeoutMs)
      : undefined;

  const init: RequestInit = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers,
    signal: controller ? controller.signal : options.signal,
  };

  if (method === "POST") {
    // Allow override but default to application/json
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    init.body = JSON.stringify(options.body ?? {});

    const wantsCsrf = shouldAttachCsrf(method, options.csrf);
    if (wantsCsrf) {
      const token = await getCsrfToken();
      if (token) headers["X-CSRF-Token"] = token;
    }
  }

  const attempt = async (): Promise<
    Result<T, ApiError<string, number, unknown> | ApiClientError>
  > => {
    try {
      const r = await fetch(url, init);
      return await parseEnvelope<T>(r);
    } catch (e) {
      // Distinguish between abort, timeout, and network errors
      if (e instanceof DOMException && e.name === "AbortError") {
        return err(networkError(true, timedOut));
      }
      return err(networkError(false, false));
    }
  };

  try {
    const first = await attempt();

    // No retry for GET or on success
    if (method !== "POST") return first;
    if (first.ok) return first;

    // Only retry once on CSRF failure
    const wantsRetry =
      retryCount === 0 &&
      retryOnCsrfFailure &&
      shouldAttachCsrf(method, options.csrf);
    if (!wantsRetry) return first;

    const problem = first.error;
    if (problem && isCsrfProblem(problem)) {
      resetCsrf();
      return await apiRequest<T>(path, { ...options, _retryCount: 1 });
    }

    return first;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortListener && options.signal) {
      options.signal.removeEventListener("abort", abortListener);
    }
  }
}

/**
 * Convenience function for GET requests.
 *
 * @example
 * const result = await apiGet<User[]>("/api/users", { page: 1, limit: 20 });
 */
export function apiGet<T>(
  path: string,
  query?: Record<string, QueryValue> | URLSearchParams,
  options: Omit<ApiRequestOptions, "method" | "query" | "body"> = {},
) {
  return apiRequest<T>(path, { ...options, method: "GET", query });
}

/**
 * Convenience function for POST requests.
 *
 * @example
 * const result = await apiPost<CreateResponse>("/api/posts", { title: "Hello" });
 */
export function apiPost<T>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
) {
  return apiRequest<T>(path, { ...options, method: "POST", body });
}

/**
 * Extracts validation issues from an error result.
 * Returns undefined if the result is successful or has no validation issues.
 */
export function getApiIssues(
  r: Result<unknown, ApiError<string, number, unknown> | ApiClientError>,
): ApiIssue[] | undefined {
  if (r.ok) return undefined;
  const error = r.error;
  return "issues" in error ? error.issues : undefined;
}