"use client";

import type { ApiEnvelope, ApiError, ApiIssue, Result } from "@/lib/api/shapes";
import { err, isApiEnvelope, ok } from "@/lib/api/shapes";

/**
 * Client-safe API client for JSON API routes.
 *
 * Returns Result<T, ApiError> for explicit error handling (never throws).
 * Handles CSRF tokens, timeouts, retries, and idempotency keys automatically.
 *
 * @see @/lib/api/shapes for type definitions
 */

const DEFAULT_TIMEOUT_MS = 30_000;

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

  /** Request timeout in milliseconds. Defaults to 30s. Set to 0 to disable. */
  timeoutMs?: number;

  /** @internal Used to prevent infinite retry loops. */
  _retryCount?: number;
};

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

// ============================================================================
// CSRF Token Management
// ============================================================================

let csrfPromise: Promise<string> | null = null;

async function fetchCsrfToken(): Promise<string> {
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

    if (!r.ok) return "";

    const json: unknown = await r.json().catch(() => null);
    if (isApiEnvelope(json) && json.ok) {
      return (json.data as { token?: string })?.token ?? "";
    }
    return "";
  } catch {
    return "";
  }
}

function getCsrfToken(): Promise<string> {
  if (!csrfPromise) {
    csrfPromise = fetchCsrfToken();
  }
  return csrfPromise;
}

/**
 * Resets the cached CSRF token, forcing a fresh fetch on next request.
 */
export function resetCsrf(): void {
  csrfPromise = null;
}

function shouldAttachCsrf(method: "GET" | "POST", override?: boolean): boolean {
  if (override === false) return false;
  if (override === true) return true;
  return method === "POST";
}

// ============================================================================
// Timeout Helper
// ============================================================================

type TimeoutContext = {
  signal: AbortSignal | undefined;
  timedOut: boolean;
  cleanup: () => void;
};

function createTimeout(timeoutMs: number, externalSignal?: AbortSignal): TimeoutContext {
  if (timeoutMs <= 0) {
    return { signal: externalSignal, timedOut: false, cleanup: () => {} };
  }

  const controller = new AbortController();
  let timedOut = false;

  const abortHandler = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortHandler, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup: () => {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortHandler);
    },
  };
}

// ============================================================================
// Query String Builder
// ============================================================================

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

// ============================================================================
// Error Helpers
// ============================================================================

function clientError(code: string, message: string, status: number = 0, meta?: unknown): ApiError {
  return { code, message, status, meta };
}

function isCsrfProblem(e: ApiError): boolean {
  return e.status === 419 || e.code === "CSRF_FAILED";
}

// ============================================================================
// Response Parser
// ============================================================================

async function parseEnvelope<T>(r: Response): Promise<Result<T, ApiError>> {
  const ct = r.headers.get("content-type");
  if (!ct || !ct.toLowerCase().includes("application/json")) {
    await r.text().catch(() => {});
    return err(clientError("CLIENT_NON_JSON_RESPONSE", "Invalid server response", r.status, { contentType: ct }));
  }

  let json: unknown;
  try {
    json = await r.json();
  } catch {
    return err(clientError("CLIENT_INVALID_RESPONSE", "Invalid server response", r.status));
  }

  if (!isApiEnvelope(json)) {
    return err(clientError("CLIENT_INVALID_RESPONSE", "Invalid server response", r.status, json));
  }

  const env = json as ApiEnvelope<T>;
  if (env.ok) {
    return ok(env.data);
  }

  return err(env.error);
}

// ============================================================================
// API Request
// ============================================================================

/**
 * Makes an API request and returns a Result for explicit handling.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Result<T, ApiError>> {
  const retryCount = options._retryCount ?? 0;
  const method: "GET" | "POST" = options.method ?? "GET";
  const retryOnCsrfFailure = options.retryOnCsrfFailure ?? true;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = `${path}${buildQuery(options.query)}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers ?? {}),
  };

  if (options.ifMatch) headers["If-Match"] = options.ifMatch;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  if (method === "POST") {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";

    if (shouldAttachCsrf(method, options.csrf)) {
      const token = await getCsrfToken();
      if (token) headers["X-CSRF-Token"] = token;
    }
  }

  const timeoutCtx = createTimeout(timeout, options.signal);

  const init: RequestInit = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
    signal: timeoutCtx.signal,
  };

  const attempt = async (): Promise<Result<T, ApiError>> => {
    try {
      const r = await fetch(url, init);
      return await parseEnvelope<T>(r);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        if (timeoutCtx.timedOut) {
          return err(clientError("CLIENT_REQUEST_TIMEOUT", "Request timeout"));
        }
        return err(clientError("CLIENT_REQUEST_ABORTED", "Request cancelled"));
      }
      return err(clientError("CLIENT_NETWORK_ERROR", "Network error"));
    }
  };

  try {
    const first = await attempt();

    if (method !== "POST" || first.ok) return first;

    const wantsRetry =
      retryCount === 0 && retryOnCsrfFailure && shouldAttachCsrf(method, options.csrf);

    if (wantsRetry && isCsrfProblem(first.error)) {
      resetCsrf();
      return await apiRequest<T>(path, { ...options, _retryCount: 1 });
    }

    return first;
  } finally {
    timeoutCtx.cleanup();
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * GET request helper.
 *
 * @example
 * const result = await apiGet<User[]>('/api/users/list', { page: 1 });
 */
export function apiGet<T>(
  path: string,
  query?: Record<string, QueryValue> | URLSearchParams,
  options: Omit<ApiRequestOptions, "method" | "query" | "body"> = {},
): Promise<Result<T, ApiError>> {
  return apiRequest<T>(path, { ...options, method: "GET", query });
}

/**
 * POST request helper.
 *
 * @example
 * const result = await apiPost<{ user: User }>('/api/users/create', { name: 'John' });
 */
export function apiPost<T>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
): Promise<Result<T, ApiError>> {
  return apiRequest<T>(path, { ...options, method: "POST", body });
}

/**
 * Extracts validation issues from an error result.
 */
export function getApiIssues(r: Result<unknown, ApiError>): ApiIssue[] | undefined {
  if (r.ok) return undefined;
  return r.error.issues;
}
