/**
 * Client-safe API client for JSON API routes.
 *
 * Returns Result<T, ApiError> for explicit error handling (never throws).
 * Handles CSRF tokens, timeouts, retries, and idempotency keys automatically.
 *
 * @see @/lib/api/shapes for type definitions
 */

"use client";

import type { ApiEnvelope, ApiError, Result } from "@/lib/api/shapes";
import { err, isApiEnvelope, ok } from "@/lib/api/shapes";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5_000;

// ============================================================================
// Public Types
// ============================================================================

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

export type ApiGetOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Max retries for network errors. Defaults to 2. Set to 0 to disable. */
  maxRetries?: number;
  /** Request timeout in milliseconds. Defaults to 30s. Set to 0 to disable. */
  timeoutMs?: number;
  /** Request ID for tracing. Auto-generated if not provided. */
  requestId?: string;
};

export type ApiPostOptions = ApiGetOptions & {
  /** If set, sent as If-Match for optimistic concurrency control. */
  ifMatch?: string;
  /** If set, sent as Idempotency-Key for safe request retries. */
  idempotencyKey?: string;
  /** Override automatic CSRF header attachment. Defaults to true. */
  csrf?: boolean;
  /** Retry once after CSRF refresh on 419. Defaults to true. */
  retryOnCsrfFailure?: boolean;
};

// ============================================================================
// Internal Types
// ============================================================================

type InternalRequestOptions = {
  method: "GET" | "POST";
  query?: Record<string, QueryValue> | URLSearchParams;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  signal?: AbortSignal;
  ifMatch?: string;
  idempotencyKey?: string;
  csrf?: boolean;
  retryOnCsrfFailure?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  requestId?: string;
  _retryCount?: number;
  _csrfRetryCount?: number;
};

// ============================================================================
// Request ID Generation
// ============================================================================

function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// CSRF Token Management
// ============================================================================

let csrfPromise: Promise<string> | null = null;
let csrfFetcher: () => Promise<string> = defaultCsrfFetcher;

async function defaultCsrfFetcher(): Promise<string> {
  try {
    const r = await fetch("/api/security/csrf", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    });
    if (!r.ok) return "";
    const json: unknown = await r.json().catch(() => null);
    if (isApiEnvelope(json) && json.ok) {
      return (json.data as { csrfToken?: string })?.csrfToken ?? "";
    }
    return "";
  } catch {
    return "";
  }
}

function getCsrfToken(): Promise<string> {
  if (!csrfPromise) {
    csrfPromise = csrfFetcher();
  }
  return csrfPromise;
}

/** Resets the cached CSRF token, forcing a fresh fetch on next request. */
export function resetCsrf(): void {
  csrfPromise = null;
}

/**
 * Updates the cached CSRF token directly (used for token rotation).
 * @internal
 */
function setCsrfToken(token: string): void {
  csrfPromise = Promise.resolve(token);
}

// ============================================================================
// Visibility-Based CSRF Refresh
// ============================================================================

let visibilityListenerInitialized = false;

/**
 * Initializes the visibility change listener for proactive CSRF token refresh.
 * Call this once in your app's root provider.
 *
 * When the page becomes visible again (e.g., user switches back to tab),
 * the CSRF token is reset to ensure freshness.
 */
export function initCsrfVisibilityRefresh(): () => void {
  if (typeof document === "undefined") return () => {};
  if (visibilityListenerInitialized) return () => {};

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      resetCsrf();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  visibilityListenerInitialized = true;

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerInitialized = false;
  };
}

// ============================================================================
// Testing Utilities (not part of public API contract)
// ============================================================================

/** @internal For testing only. Injects a custom CSRF fetcher. */
export const __testing__ = {
  setCsrfFetcher: (fetcher: () => Promise<string>): void => {
    csrfFetcher = fetcher;
    csrfPromise = null;
  },
  resetCsrfFetcher: (): void => {
    csrfFetcher = defaultCsrfFetcher;
    csrfPromise = null;
  },
};

// ============================================================================
// Retry Logic
// ============================================================================

function calculateBackoff(attempt: number): number {
  const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 100;
  return Math.min(delay + jitter, RETRY_MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: ApiError): boolean {
  const retryableCodes = ["CLIENT_NETWORK_ERROR", "CLIENT_REQUEST_TIMEOUT"];
  const retryableStatuses = [502, 503, 504];
  return retryableCodes.includes(error.code) || retryableStatuses.includes(error.status);
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
// Response Parser
// ============================================================================

async function parseResponse<T>(r: Response, requestId: string): Promise<Result<T, ApiError>> {
  // Token rotation: if server sends a new CSRF token, update the cache
  const newCsrfToken = r.headers.get("X-CSRF-Token-Refresh");
  if (newCsrfToken) {
    setCsrfToken(newCsrfToken);
  }

  const ct = r.headers.get("content-type");
  if (!ct || !ct.toLowerCase().includes("application/json")) {
    await r.text().catch(() => {});
    return err({ code: "CLIENT_NON_JSON_RESPONSE", message: "Invalid server response", status: r.status, meta: { contentType: ct, requestId } });
  }

  let json: unknown;
  try {
    json = await r.json();
  } catch {
    return err({ code: "CLIENT_INVALID_RESPONSE", message: "Invalid server response", status: r.status, meta: { requestId } });
  }

  if (!isApiEnvelope(json)) {
    return err({ code: "CLIENT_INVALID_RESPONSE", message: "Invalid server response", status: r.status, meta: { raw: json, requestId } });
  }

  const env = json as ApiEnvelope<T>;
  if (env.ok) {
    return ok(env.data);
  }

  return err({ ...env.error, meta: { ...((env.error.meta as object) ?? {}), requestId } });
}

// ============================================================================
// Internal Request Implementation
// ============================================================================

async function request<T>(path: string, opts: InternalRequestOptions): Promise<Result<T, ApiError>> {
  const retryCount = opts._retryCount ?? 0;
  const csrfRetryCount = opts._csrfRetryCount ?? 0;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryOnCsrfFailure = opts.retryOnCsrfFailure ?? true;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestId = opts.requestId ?? generateRequestId();

  const url = `${path}${buildQuery(opts.query)}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-Request-ID": requestId,
    ...(opts.headers ?? {}),
  };

  if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  if (opts.method === "POST") {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    if (opts.csrf !== false) {
      const token = await getCsrfToken();
      if (token) headers["X-CSRF-Token"] = token;
    }
  }

  const timeoutCtx = createTimeout(timeout, opts.signal);

  const init: RequestInit = {
    method: opts.method,
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
    signal: timeoutCtx.signal,
  };

  const attempt = async (): Promise<Result<T, ApiError>> => {
    try {
      const r = await fetch(url, init);
      return await parseResponse<T>(r, requestId);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        if (timeoutCtx.timedOut) {
          return err({ code: "CLIENT_REQUEST_TIMEOUT", message: "Request timeout", status: 0, meta: { requestId } });
        }
        return err({ code: "CLIENT_REQUEST_ABORTED", message: "Request cancelled", status: 0, meta: { requestId } });
      }
      return err({ code: "CLIENT_NETWORK_ERROR", message: "Network error", status: 0, meta: { requestId } });
    }
  };

  try {
    const result = await attempt();

    if (result.ok) return result;

    // CSRF retry (separate from network retry)
    if (opts.method === "POST" && csrfRetryCount === 0 && retryOnCsrfFailure && (result.error.status === 419 || result.error.code === "CSRF_FAILED")) {
      resetCsrf();
      return await request<T>(path, { ...opts, requestId, _csrfRetryCount: 1 });
    }

    // Network retry with exponential backoff
    if (retryCount < maxRetries && isRetryableError(result.error)) {
      const delay = calculateBackoff(retryCount);
      await sleep(delay);
      return await request<T>(path, { ...opts, requestId, _retryCount: retryCount + 1 });
    }

    return result;
  } finally {
    timeoutCtx.cleanup();
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * GET request helper.
 *
 * @example
 * const result = await apiGet<User[]>('/api/users/list', { page: 1 });
 * if (result.ok) {
 *   console.log(result.value);
 * } else {
 *   console.error(result.error);
 * }
 */
export function apiGet<T>(
  path: string,
  query?: Record<string, QueryValue> | URLSearchParams,
  options: ApiGetOptions = {},
): Promise<Result<T, ApiError>> {
  return request<T>(path, { ...options, method: "GET", query });
}

/**
 * POST request helper.
 *
 * @example
 * const result = await apiPost<{ user: User }>('/api/users/create', { name: 'John' });
 * if (result.ok) {
 *   console.log(result.value);
 * } else {
 *   console.error(result.error);
 * }
 */
export function apiPost<T>(
  path: string,
  body?: Record<string, unknown> | unknown[],
  options: ApiPostOptions = {},
): Promise<Result<T, ApiError>> {
  return request<T>(path, { ...options, method: "POST", body });
}
