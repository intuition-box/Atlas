'use client';

import { isApiResponse } from "@/types/api";

/**
 * Tiny browser RPC client (V3)
 * - Single entry: rpcRequest<T>(path, body?, opts?)
 * - Envelope required: { success:true, data } | { success:false, error:{ code, message, details? } }
 * - POST by default; set opts.method = 'GET' to send query-only requests
 * - Sends CSRF token for POST when available; retries once on CSRF errors
 * - Supports Idempotency-Key and If-Match headers
 */

let csrfCache: string = '';
let csrfInitialized = false; // false until first attempt; then true (even if no token available)

export type RpcOptions = {
  method?: 'GET' | 'POST';
  ifMatch?: string; // pass ETag when editing/deleting
  idempotencyKey?: string; // for create/mutate flows
  signal?: AbortSignal;
  headers?: Record<string, string>;
  // You can opt-in to force a fresh CSRF fetch (rarely needed)
  refreshCsrf?: boolean;
};

export class RpcError<T = unknown> extends Error {
  /** HTTP status code from the Response. */
  status: number;
  /** Optional application-level error code from the ApiResponse envelope. */
  code?: number;
  details?: T;
  constructor(httpStatus: number, message: string, details?: T, code?: number) {
    super(message);
    this.name = 'RpcError';
    this.status = httpStatus;
    this.code = code;
    this.details = details;
  }
}

export function resetCsrf() {
  csrfCache = '';
  csrfInitialized = false;
}

async function getCsrf(): Promise<string> {
  if (csrfInitialized) return csrfCache;
  try {
    const r = await fetch('/api/security/csrf', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!r.ok) {
      // If the endpoint is absent/disabled, proceed without a token.
      if (r.status === 404 || r.status === 405 || r.status === 501) {
        csrfCache = '';
        csrfInitialized = true;
        return csrfCache;
      }
      throw new RpcError(r.status, 'CSRF bootstrap failed');
    }
    const json = await r.json().catch(() => null);
    const token = typeof (json as any)?.data?.token === 'string' ? (json as any).data.token : '';
    csrfCache = token;
    csrfInitialized = true;
    return csrfCache;
  } catch {
    // Network error — don’t block; proceed without header.
    csrfCache = '';
    csrfInitialized = true;
    return csrfCache;
  }
}

function buildQuery(params: Record<string, unknown> | URLSearchParams | undefined) {
  if (!params) return '';
  if (params instanceof URLSearchParams) {
    const s = params.toString();
    return s ? `?${s}` : '';
  }
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    sp.append(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function parseApiResponse<T>(r: Response): Promise<T> {
  const fallbackMessage = (status: number) => {
    if (status === 401) return 'Please sign in to continue.';
    if (status === 403) return 'You don’t have permission to do that.';
    if (status === 404) return 'Not found.';
    if (status === 409) return 'Conflict. Please refresh and try again.';
    if (status === 412) return 'Out of date. Please refresh and try again.';
    if (status === 419) return 'Security check expired. Please refresh and try again.';
    if (status === 429) return 'Too many requests. Please try again soon.';
    if (status >= 500) return 'Server error. Please try again.';
    return 'Request failed. Please try again.';
  };

  const ct = r.headers.get('content-type') || '';

  // If the server didn't return our JSON envelope, prefer a friendly, user-safe message.
  if (!ct.includes('application/json')) {
    // Try to consume the body to avoid leaking raw HTML/stack traces into the UI.
    try {
      await r.text();
    } catch {
      // ignore
    }
    throw new RpcError(r.status, fallbackMessage(r.status));
  }

  let json: unknown;
  try {
    json = await r.json();
  } catch {
    throw new RpcError(r.status, fallbackMessage(r.status));
  }

  if (!isApiResponse<T>(json)) {
    throw new RpcError(r.status, 'Invalid server response', json);
  }

  if (json.success === true) {
    return json.data as T;
  }

  const code = typeof json.error?.code === 'number' ? json.error.code : undefined;
  const rawMessage = typeof json.error?.message === 'string' ? json.error.message : '';

  // If the server didn't provide a meaningful message, use a friendly status-based fallback.
  const message = rawMessage && !/^Request failed \(\d+\)$/.test(rawMessage)
    ? rawMessage
    : fallbackMessage(r.status);

  throw new RpcError(r.status, message, json.error?.details, code);
}

export async function rpcRequest<T>(
  path: string,
  body?: unknown,
  opts: RpcOptions = {},
): Promise<T> {
  const method: 'GET' | 'POST' = opts.method ?? 'POST';
  const isGet = method === 'GET';

  const url = isGet && body && typeof body === 'object'
    ? `${path}${buildQuery(body as Record<string, unknown>)}`
    : path;

  const headers: Record<string, string> = {
    ...(opts.headers ?? {}),
  };
  headers['Accept'] = 'application/json';
  headers['X-Requested-With'] = 'XMLHttpRequest';

  let reqBody: string | undefined;

  if (!isGet) {
    if (opts.refreshCsrf) resetCsrf();
    const csrf = await getCsrf();
    headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-CSRF-Token'] = csrf; // optional if token available
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    reqBody = JSON.stringify(body ?? {});
  }

  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    body: reqBody,
    signal: opts.signal,
  });

  try {
    return await parseApiResponse<T>(r);
  } catch (err) {
    if (!isGet && err instanceof RpcError) {
      const status = err.status;
      const msg = String(err.message || '');
      if (status === 419 || (status === 403 && /csrf/i.test(msg))) {
        if (!opts.refreshCsrf) {
          resetCsrf();
          return rpcRequest<T>(path, body, { ...opts, refreshCsrf: true });
        }
      }
    }
    throw err;
  }
}

export async function rpcGet<T>(
  path: string,
  params?: Record<string, unknown> | URLSearchParams,
  opts?: Omit<RpcOptions, 'method'>,
): Promise<T> {
  return rpcRequest<T>(path, params, { ...(opts ?? {}), method: 'GET' });
}

export async function rpcPost<T>(
  path: string,
  body?: unknown,
  opts?: Omit<RpcOptions, 'method'>,
): Promise<T> {
  return rpcRequest<T>(path, body, { ...(opts ?? {}), method: 'POST' });
}