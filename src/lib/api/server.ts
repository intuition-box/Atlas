/**
 * Minimal, production-ready API bootstrap for Next.js App Router.
 *
 * Canonical JSON envelope (see `src/lib/api-shapes.ts`):
 * - { ok: true, data }
 * - { ok: false, error: { code, message, status, issues?, meta? } }
 *
 * Convention: use GET and POST only.
 */

import "server-only";

import type { Session } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import type { ApiEnvelope, ApiError, ApiIssue } from "@/lib/api/shapes";
import { errEnvelope, okEnvelope } from "@/lib/api/shapes";
import type { AuthProblem } from "@/lib/auth/policy";
import { requireAuth, requireOnboarded } from "@/lib/auth/policy";
import { requireCsrf } from "@/lib/security/csrf";
import { buildRateLimitHeaders, getRateLimitKey, rateLimit } from "@/lib/security/rate-limit";
import { requireIdempotencyKey } from "@/lib/idempotency";

export type Method = "GET" | "POST";
export type AuthMode = "public" | "auth" | "onboarded";

export type ApiServerErrorCode =
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "QUERY_STRING_TOO_LARGE"
  | "INVALID_JSON"
  | "REQUEST_READ_FAILED"
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "CSRF_FAILED"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_REQUIRED";

export type WithApiOpts = {
  /** Allowed HTTP methods (default: ["POST"]) */
  methods?: Method[];

  /** Authentication mode (default: "auth") */
  auth?: AuthMode;

  /** Require CSRF token for POST (default: true) */
  csrf?: boolean;

  /**
   * Enforce same-origin POSTs (default: true).
   * Checks Origin header first, falls back to Referer.
   * Missing headers are treated as forbidden.
   */
  checkOrigin?: boolean;

  /** Explicit origin allowlist (default: [req.nextUrl.origin]) */
  allowOrigins?: string[];

  /** Enforce `application/json` for POST (default: true) */
  requireJson?: boolean;

  /** Max accepted JSON bytes for POST (default: 256 KiB) */
  maxJsonBytes?: number;

  /** Max query string bytes for GET (default: 8 KiB) */
  maxQueryBytes?: number;

  /**
   * If true and method is POST, Idempotency-Key header is required (default: false).
   * Used for operations that should be safely retryable.
   */
  requireIdempotency?: boolean;

  /**
   * Rate key builder (default: derived from userId or hashed-ip identity).
   * IMPORTANT: Do NOT include request body values in the key.
   * 
   * Example:
   *   rateKey: (viewerId, req) => `custom:${viewerId}:${req.nextUrl.pathname}`
   */
  rateKey?: (viewerId: string | null, req: NextRequest) => string;

  /**
   * Rate limit policy id (default: "api").
   * Define policies in src/lib/rate-limit.ts
   */
  ratePolicyId?: string;

  /**
   * Include detailed rate limit headers in 429 responses (default: true).
   * Set to false to prevent leaking rate limit thresholds to attackers.
   */
  exposeRateLimitHeaders?: boolean;
};

export type ApiContext<T> = {
  req: NextRequest;
  session: Session | null;
  viewerId: string | null;
  handle: string | null;
  json: T;
  idempotencyKey: string | null;
  /**
   * If-Match header value (for ETag-based conditional requests).
   * Use to implement optimistic concurrency control.
   */
  ifMatch: string | null;
};

export type ApiHandler<T> = (ctx: ApiContext<T>) => Promise<NextResponse>;

function okJson<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");

  return NextResponse.json<ApiEnvelope<T>>(okEnvelope(data), { ...(init ?? {}), headers });
}

function errJson(error: ApiError, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");

  return NextResponse.json<ApiEnvelope<never>>(errEnvelope(error), {
    ...(init ?? {}),
    status: error.status,
    headers,
  });
}

function extractErrorStatus(err: unknown, defaultStatus: number): number {
  if (typeof (err as any)?.status === "number") {
    return (err as any).status;
  }
  if (typeof (err as any)?.cause?.status === "number") {
    return (err as any).cause.status;
  }
  return defaultStatus;
}

function extractErrorMessage(err: unknown, defaultMessage: string): string {
  if (typeof (err as any)?.message === "string") {
    return (err as any).message;
  }
  return defaultMessage;
}

async function readJsonBody(req: NextRequest, maxBytes: number): Promise<
  | { ok: true; value: unknown }
  | { ok: false; error: ApiError }
> {
  let text: string;
  try {
    text = await req.text();
  } catch (e) {
    // Network errors, timeouts, or other read failures
    return {
      ok: false,
      error: {
        code: "REQUEST_READ_FAILED",
        message: "Failed to read request body",
        status: 400,
      },
    };
  }

  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    return {
      ok: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Payload too large",
        status: 413,
        meta: { maxBytes, actualBytes: bytes },
      },
    };
  }

  // Empty body is invalid JSON for our API routes.
  if (!text.trim()) {
    return { ok: false, error: { code: "INVALID_JSON", message: "Invalid JSON", status: 400 } };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: { code: "INVALID_JSON", message: "Invalid JSON", status: 400 } };
  }
}

function detectRequestOrigin(req: NextRequest): string | null {
  const originHdr = req.headers.get("origin");
  if (originHdr) {
    try {
      const u = new URL(originHdr);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }

  // Fallback to Referer (less reliable, includes path)
  const refererHdr = req.headers.get("referer");
  if (refererHdr) {
    try {
      const u = new URL(refererHdr);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }

  return null;
}

function originAllowed(req: NextRequest, explicit?: string[]): boolean {
  const origin = detectRequestOrigin(req);
  if (!origin) return false;

  const allow = explicit && explicit.length > 0 ? explicit : [req.nextUrl.origin];
  return allow.includes(origin);
}

function asApiErrorFromAuthProblem(p: AuthProblem): ApiError {
  return { code: p.code, message: p.message, status: p.status };
}

/**
 * withApi: validates the request and returns either a NextResponse error
 * or a hydrated context object for the route handler.
 * 
 * Validation order (optimized for security):
 * 1. HTTP method check
 * 2. Authentication (if required)
 * 3. Origin check (POST)
 * 4. CSRF validation (POST, session-dependent)
 * 5. Content-Type validation (POST)
 * 6. Rate limiting (before parsing to prevent abuse)
 * 7. Payload parsing and size check
 * 8. Schema validation
 * 9. Idempotency key extraction
 */
export async function withApi<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
  opts: WithApiOpts = {},
): Promise<NextResponse | Omit<ApiContext<z.infer<S>>, "req">> {
  // 1. Methods
  const methods = opts.methods ?? ["POST"];
  if (!methods.includes(req.method as Method)) {
    return errJson(
      {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        status: 405,
        meta: { allowed: methods },
      },
      { headers: { Allow: methods.join(", ") } },
    );
  }

  // 2. Auth
  const authMode = opts.auth ?? "auth";
  let session: Session | null = null;
  let viewerId: string | null = null;
  let handle: string | null = null;

  if (authMode === "auth") {
    try {
      const a = await requireAuth();
      session = a.session;
      viewerId = a.userId;
    } catch (e) {
      return errJson(asApiErrorFromAuthProblem(e as AuthProblem));
    }
  } else if (authMode === "onboarded") {
    try {
      const a = await requireOnboarded();
      session = a.session;
      viewerId = a.userId;
      handle = a.handle;
    } catch (e) {
      return errJson(asApiErrorFromAuthProblem(e as AuthProblem));
    }
  }

  // 3. Same-origin check (browser POSTs)
  const checkOrigin = opts.checkOrigin !== false;
  if (checkOrigin && req.method === "POST") {
    if (!originAllowed(req, opts.allowOrigins)) {
      return errJson({ code: "FORBIDDEN", message: "Forbidden", status: 403 });
    }
  }

  // 4. CSRF (POST by default). Set opts.csrf=false only for explicit non-browser/machine routes.
  const needsCsrf = opts.csrf !== false && req.method === "POST";
  if (needsCsrf) {
    try {
      await requireCsrf(req);
    } catch (err: any) {
      const status = extractErrorStatus(err, 419);
      const message = extractErrorMessage(err, "Security check failed");
      return errJson({ code: "CSRF_FAILED", message, status });
    }
  }

  // 5. Enforce JSON Content-Type on POST
  const requireJson = opts.requireJson !== false;
  if (requireJson && req.method === "POST") {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return errJson({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Expected application/json", status: 415 });
    }
  }

  // 6. Rate limit (before parsing to prevent abuse)
  const policyId = opts.ratePolicyId ?? "api";
  const key = opts.rateKey ? opts.rateKey(viewerId, req) : getRateLimitKey(req, viewerId ?? undefined);
  const rl = await rateLimit({ key, policyId });
  if (!rl.allowed) {
    const exposeHeaders = opts.exposeRateLimitHeaders !== false;
    return errJson(
      { code: "RATE_LIMITED", message: "Too many requests", status: 429 },
      { headers: exposeHeaders ? buildRateLimitHeaders(rl) : undefined },
    );
  }

  // 7. Parse payload
  let payload: unknown;
  if (req.method === "GET") {
    // Check query string size to prevent abuse
    const maxQueryBytes = opts.maxQueryBytes ?? 8_192; // 8 KiB
    const queryString = req.nextUrl.search;
    const queryBytes = new TextEncoder().encode(queryString).byteLength;

    if (queryBytes > maxQueryBytes) {
      return errJson({
        code: "QUERY_STRING_TOO_LARGE",
        message: "Query string too large",
        status: 414,
        meta: { maxBytes: maxQueryBytes, actualBytes: queryBytes },
      });
    }

    // Note: All query params are strings. Use z.coerce.number() etc. in your schema.
    payload = Object.fromEntries(req.nextUrl.searchParams.entries());
  } else {
    const max = opts.maxJsonBytes ?? 262_144; // 256 KiB
    const parsed = await readJsonBody(req, max);
    if (!parsed.ok) return errJson(parsed.error);
    payload = parsed.value;
  }

  // 8. Zod validation (async-safe)
  const parsed = await schema.safeParseAsync(payload);
  if (!parsed.success) {
    return errJson({
      code: "INVALID_REQUEST",
      message: "Invalid request",
      status: 400,
      issues: parsed.error.issues.map((iss) => ({
        path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
        message: iss.message,
      })),
    });
  }

  // 9. Extract conditional and idempotency headers
  const ifMatch = req.headers.get("if-match");
  let idempotencyKey: string | null = null;

  if (opts.requireIdempotency && req.method === "POST") {
    try {
      idempotencyKey = requireIdempotencyKey(req);
    } catch (err: any) {
      const status = extractErrorStatus(err, 400);
      const message = extractErrorMessage(err, "Idempotency-Key required");
      return errJson({ code: "IDEMPOTENCY_REQUIRED", message, status });
    }
  } else {
    // Optional idempotency key (not required but available if provided)
    const headerKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    idempotencyKey = headerKey;
  }

  return { session, viewerId, handle, json: parsed.data, idempotencyKey, ifMatch };
}

/**
 * api: sugar to build a Next.js route handler from a Zod schema and an async handler.
 */
export function api<S extends z.ZodTypeAny>(
  schema: S,
  handler: ApiHandler<z.infer<S>>,
  opts?: WithApiOpts,
) {
  return async (req: NextRequest) => {
    const ctx = await withApi(req, schema, opts);
    if (ctx instanceof NextResponse) return ctx;
    return handler({ req, ...ctx });
  };
}

export { okJson, errJson };