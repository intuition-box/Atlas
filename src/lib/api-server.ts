/**
 * Minimal, production-ready RPC bootstrap for Next.js App Router.
 * - Auth modes: required | optional | none
 * - CSRF for non-GET (defense-in-depth)
 * - Same-origin checks for browser POSTs
 * - GET/HEAD query or POST JSON parsing with Zod (async)
 * - Optional payload size cap
 * - Per-route rate limiting with standard headers
 * - Optional Idempotency-Key requirement
 * - Standard ApiResponse<T> response contract
 */

import type { Session } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { requireCsrf } from '@/lib/security/csrf';
import { rateLimit, buildRateLimitHeaders, getRateLimitKey } from '@/lib/rate-limit';
import { requireIdempotencyKey } from '@/lib/idempotency';
import type { ApiErrorCode, ApiResponse } from '@/types/api';

export type Method = 'GET' | 'POST' | 'HEAD';
export type AuthMode = 'required' | 'optional' | 'none';

export type RpcHandler<T> = (ctx: {
  req: NextRequest;
  session: Session | null;
  viewerId: string | null;
  json: T;
  idempotencyKey: string | null;
}) => Promise<NextResponse>;

/** Error helper: returns a consistent ApiResponse error envelope. */
export function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  init?: ResponseInit,
) {
  const headers = new Headers(init?.headers);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');

  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: { code, message, details } },
    { ...(init ?? {}), status, headers },
  );
}

/** Success helper: returns a consistent ApiResponse<T> success envelope. */
export function ok<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');

  return NextResponse.json<ApiResponse<T>>({ success: true, data }, { ...(init ?? {}), headers });
}

function sameOrigin(u: string, allowed: string[]): boolean {
  try {
    const o = new URL(u);
    const origin = `${o.protocol}//${o.host}`;
    return allowed.includes(origin);
  } catch {
    return false;
  }
}

function detectRequestOrigin(req: NextRequest): string | null {
  const hdr = req.headers.get('origin') || req.headers.get('referer');
  if (!hdr) return null;
  try {
    const u = new URL(hdr);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function defaultAllowedOrigins(req: NextRequest, explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) return explicit;
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL;
  return [envOrigin || req.nextUrl.origin].filter(Boolean) as string[];
}

export type WithRpcOpts<T> = {
  /** Allowed HTTP methods (default: ['POST']) */
  methods?: Method[];
  /** Authentication mode (default: 'required') */
  auth?: AuthMode;
  /** Require CSRF token for non-GET (default: true) */
  csrf?: boolean;
  /** Rate key builder (default: derived from userId or hashed-ip identity). Do NOT include request body values. */
  rateKey?: (viewerId: string | null, req: NextRequest) => string;
  /** Rate limit policy id (default: 'rpc'). Define policies in src/lib/rate-limit.ts */
  ratePolicyId?: string;
  /** Enforce `application/json` for POST (default: true) */
  requireJson?: boolean;
  /** Enforce same-origin POSTs (default: true) */
  checkOrigin?: boolean;
  /** Explicit origin allowlist (default: NEXT_PUBLIC_APP_URL or req.nextUrl.origin) */
  allowOrigins?: string[];
  /** Max accepted JSON bytes for POST (default: 256 KiB) */
  maxJsonBytes?: number;
  /** If true and method is POST, Idempotency-Key header is required (default: false) */
  requireIdempotency?: boolean;
};

/**
 * withRpc: validates the request and returns either a NextResponse error
 * or a hydrated context object for the route handler.
 */
export async function withRpc<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
  opts: WithRpcOpts<z.infer<S>> = {},
): Promise<
  | NextResponse
  | {
      session: Session | null;
      viewerId: string | null;
      json: z.infer<S>;
      idempotencyKey: string | null;
    }
> {
  // Methods
  const methods = opts.methods ?? ['POST'];
  if (!methods.includes(req.method as Method)) {
    return fail(405, 'BAD_REQUEST', 'Method Not Allowed');
  }

  // Auth
  const authMode = opts.auth ?? 'required';
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  if (authMode === 'required' && !viewerId) {
    return fail(401, 'UNAUTHENTICATED', 'Unauthorized');
  }

  // Same-origin (browser POSTs)
  const checkOrigin = opts.checkOrigin !== false; // default true
  if (checkOrigin && req.method === 'POST') {
    const seenOrigin = detectRequestOrigin(req);
    if (seenOrigin) {
      const allow = defaultAllowedOrigins(req, opts.allowOrigins);
      if (!sameOrigin(seenOrigin, allow)) {
        return fail(403, 'FORBIDDEN', 'Cross-site request blocked');
      }
    }
  }

  // CSRF (enforced for unsafe methods by default). Set opts.csrf=false only for explicit non-browser/machine routes.
  const needsCsrf = opts.csrf !== false && req.method !== 'GET' && req.method !== 'HEAD';
  if (needsCsrf) {
    try {
      requireCsrf(req);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 403;
      const message = typeof err?.message === 'string' ? err.message : 'CSRF verification failed';
      return fail(status, 'FORBIDDEN', message, undefined, { headers: { 'Cache-Control': 'no-store' } });
    }
  }

  // Enforce JSON Content-Type on POST (accepts 'application/json; charset=utf-8')
  const requireJson = opts.requireJson !== false; // default true
  if (requireJson && req.method === 'POST') {
    const ct = (req.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      return fail(415, 'BAD_REQUEST', 'Expected application/json');
    }
  }

  // Optional payload size cap
  if (req.method === 'POST') {
    const max = opts.maxJsonBytes ?? 262_144; // 256 KiB
    const cl = Number(req.headers.get('content-length') || '0');
    if (cl && cl > max) {
      return fail(413, 'BAD_REQUEST', 'Payload too large');
    }
  }

  // Parse payload
  let payload: unknown;
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      payload = Object.fromEntries(req.nextUrl.searchParams.entries());
    } else {
      payload = await req.json();
    }
  } catch {
    return fail(400, 'BAD_REQUEST', 'Invalid JSON');
  }

  // Zod validation (async-safe)
  const parsed = await schema.safeParseAsync(payload);
  if (!parsed.success) {
    const details = parsed.error.issues?.map((i) => ({ path: i.path, code: i.code, message: i.message }));
    return fail(400, 'VALIDATION', 'Invalid request', details);
  }
  const data = parsed.data as z.infer<S>;

  // Rate limit (enforce with standard headers)
  const policyId = opts.ratePolicyId ?? 'rpc';
  const key = opts.rateKey ? opts.rateKey(viewerId, req) : getRateLimitKey(req, viewerId ?? undefined);
  const rl = await rateLimit({ key, policyId });
  if (!rl.allowed) {
    return fail(429, 'RATE_LIMITED', 'Too many requests', undefined, {
      headers: {
        ...buildRateLimitHeaders(rl),
        'Cache-Control': 'no-store',
      },
    });
  }

  // Idempotency header
  let idempotencyKey: string | null = req.headers.get('Idempotency-Key');
  if (opts.requireIdempotency && req.method === 'POST') {
    try {
      idempotencyKey = requireIdempotencyKey(req);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const message = typeof err?.message === 'string' ? err.message : 'Idempotency-Key required';
      return fail(status, 'BAD_REQUEST', message, undefined, { headers: { 'Cache-Control': 'no-store' } });
    }
  }

  return { session, viewerId, json: data, idempotencyKey };
}

/**
 * rpc: sugar to build a Next.js route handler from a Zod schema and an async handler.
 * Usage:
 *   export const POST = rpc(Schema, async ({ json, viewerId }) => { ... });
 */
export function rpc<S extends z.ZodTypeAny>(
  schema: S,
  handler: RpcHandler<z.infer<S>>,
  opts?: WithRpcOpts<z.infer<S>>,
) {
  return async (req: NextRequest) => {
    const ctx = await withRpc(req, schema, opts);
    if (ctx instanceof NextResponse) return ctx;
    return handler({ req, ...ctx });
  };
}