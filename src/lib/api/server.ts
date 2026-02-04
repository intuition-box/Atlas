/**
 * Server-side API middleware for Next.js App Router.
 *
 * Provides `api()` for building secure, validated route handlers.
 * All routes return ApiEnvelope<T> responses.
 *
 * @see @/lib/api/shapes for type definitions
 */

import "server-only";

import type { Session } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import type { ApiEnvelope, ApiError, ApiIssue, Result } from "@/lib/api/shapes";
import { apiErr, apiOk, err, ok } from "@/lib/api/shapes";
import { AuthErrorSchema, requireAuth, requireOnboarded } from "@/lib/auth/policy";
import { requireCsrf } from "@/lib/security/csrf";
import { buildRateLimitHeaders, getRateLimitKey, rateLimit } from "@/lib/security/rate-limit";
import { requireIdempotencyKey } from "@/lib/idempotency";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_MAX_JSON_BYTES = 262_144; // 256 KiB
const DEFAULT_MAX_QUERY_BYTES = 8_192; // 8 KiB

// ============================================================================
// Types
// ============================================================================

export type ApiMethod = "GET" | "POST";
export type ApiAuthMode = "public" | "auth" | "onboarded";

export type ApiOptions = {
  /** Allowed HTTP methods (default: ["POST"]) */
  methods?: ApiMethod[];
  /** Authentication mode (default: "auth") */
  auth?: ApiAuthMode;
  /** Require CSRF token for POST (default: true) */
  csrf?: boolean;
  /** Enforce same-origin POSTs (default: true) */
  checkOrigin?: boolean;
  /** Explicit origin allowlist (default: [req.nextUrl.origin]) */
  allowOrigins?: string[];
  /** Enforce application/json for POST (default: true) */
  requireJson?: boolean;
  /** Max JSON body bytes for POST (default: 256 KiB) */
  maxJsonBytes?: number;
  /** Max query string bytes for GET (default: 8 KiB) */
  maxQueryBytes?: number;
  /** Require Idempotency-Key header for POST (default: false) */
  requireIdempotency?: boolean;
  /** Rate limit policy ID (default: "api") */
  ratePolicyId?: string;
  /** Custom rate limit key builder */
  rateKey?: (viewerId: string | null, req: NextRequest) => string;
  /** Include rate limit headers in 429 responses (default: true) */
  exposeRateLimitHeaders?: boolean;
};

export type ApiContext<T> = {
  req: NextRequest;
  session: Session | null;
  viewerId: string | null;
  handle: string | null;
  json: T;
  idempotencyKey: string | null;
  ifMatch: string | null;
  requestId: string;
  /** The auth mode used for this request (for observability/logging) */
  authMode: ApiAuthMode;
};

// ============================================================================
// Zod Schema for Catching Thrown Errors
// ============================================================================

const ErrorWithStatusSchema = z.object({
  status: z.number(),
  message: z.string(),
});

// ============================================================================
// Response Helpers
// ============================================================================

export function okJson<T>(data: T, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  return NextResponse.json<ApiEnvelope<T>>(apiOk(data), { ...init, headers });
}

export function errJson(error: ApiError, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  if (
    typeof error.meta === "object" &&
    error.meta !== null &&
    "requestId" in error.meta &&
    typeof error.meta.requestId === "string" &&
    !headers.has("X-Request-ID")
  ) {
    headers.set("X-Request-ID", error.meta.requestId);
  }
  return NextResponse.json<ApiEnvelope<never>>(apiErr(error), {
    ...init,
    status: error.status,
    headers,
  });
}

// ============================================================================
// Internal Helpers
// ============================================================================

function getRequestId(req: NextRequest): string {
  return req.headers.get("x-request-id") ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const u = new URL(origin);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
  return null;
}

async function parseBody(req: NextRequest, maxBytes: number): Promise<Result<unknown, ApiError>> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return err({ code: "REQUEST_READ_FAILED", message: "Failed to read request body", status: 400 });
  }

  const actualBytes = new TextEncoder().encode(text).byteLength;
  if (actualBytes > maxBytes) {
    return err({ code: "PAYLOAD_TOO_LARGE", message: "Payload too large", status: 413, meta: { maxBytes, actualBytes } });
  }

  if (!text.trim()) {
    return err({ code: "INVALID_JSON", message: "Invalid JSON", status: 400 });
  }

  try {
    return ok(JSON.parse(text));
  } catch {
    return err({ code: "INVALID_JSON", message: "Invalid JSON", status: 400 });
  }
}

async function validateWithSchema<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
): Promise<Result<z.infer<S>, ApiError>> {
  const result = await schema.safeParseAsync(payload);
  if (result.success) {
    return ok(result.data);
  }
  const issues: ApiIssue[] = result.error.issues.map((iss) => ({
    path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
    message: iss.message,
  }));
  return err({ code: "INVALID_REQUEST", message: "Invalid request", status: 400, issues });
}

// ============================================================================
// Main API Builder
// ============================================================================

/**
 * Build a Next.js route handler with validation, auth, CSRF, and rate limiting.
 *
 * @example
 * export const POST = api(schema, async (ctx) => {
 *   const { viewerId, json, requestId } = ctx;
 *   return okJson({ success: true });
 * }, { auth: 'onboarded' });
 */
export function api<S extends z.ZodTypeAny>(
  schema: S,
  handler: (ctx: ApiContext<z.infer<S>>) => Promise<NextResponse>,
  opts: ApiOptions = {},
) {
  const methods = opts.methods ?? ["POST"];
  const authMode = opts.auth ?? "auth";

  return async (req: NextRequest): Promise<NextResponse> => {
    const requestId = getRequestId(req);
    const isPost = req.method === "POST";

    const withMeta = (error: ApiError): ApiError => ({
      ...error,
      meta: { ...(typeof error.meta === "object" && error.meta !== null ? error.meta : {}), requestId },
    });

    try {
      // 1. Method
      if (!methods.includes(req.method as ApiMethod)) {
        return errJson(withMeta({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed", status: 405, meta: { allowed: methods } }), {
          headers: { Allow: methods.join(", ") },
        });
      }

      // 2. Auth
      let session: Session | null = null;
      let viewerId: string | null = null;
      let handle: string | null = null;

      if (authMode !== "public") {
        try {
          if (authMode === "auth") {
            const auth = await requireAuth();
            session = auth.session;
            viewerId = auth.userId;
          } else {
            const auth = await requireOnboarded();
            session = auth.session;
            viewerId = auth.userId;
            handle = auth.handle;
          }
        } catch (e) {
          const parsed = AuthErrorSchema.safeParse(e);
          if (parsed.success) {
            return errJson(withMeta({ code: parsed.data.code, message: parsed.data.message, status: parsed.data.status }));
          }
          return errJson(withMeta({ code: "AUTH_FAILED", message: "Authentication failed", status: 401 }));
        }
      }

      // 3. Origin (POST only)
      if (isPost && opts.checkOrigin !== false) {
        const origin = getOrigin(req);
        const allowed = opts.allowOrigins?.length ? opts.allowOrigins : [req.nextUrl.origin];
        if (!origin || !allowed.includes(origin)) {
          return errJson(withMeta({ code: "FORBIDDEN", message: "Forbidden", status: 403 }));
        }
      }

      // 4. CSRF (POST only)
      if (isPost && opts.csrf !== false) {
        const csrfResult = requireCsrf(req);
        if (!csrfResult.ok) {
          return errJson(withMeta({ code: "CSRF_FAILED", message: csrfResult.error.message, status: csrfResult.error.status }));
        }
      }

      // 5. Content-Type (POST only)
      if (isPost && opts.requireJson !== false) {
        const ct = (req.headers.get("content-type") ?? "").toLowerCase();
        if (!ct.includes("application/json")) {
          return errJson(withMeta({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Expected application/json", status: 415 }));
        }
      }

      // 6. Rate limit
      const rlKey = opts.rateKey ? opts.rateKey(viewerId, req) : getRateLimitKey(req, viewerId ?? undefined);
      const rlResult = await rateLimit({ key: rlKey, policyId: opts.ratePolicyId ?? "api" });
      if (!rlResult.allowed) {
        const headers = opts.exposeRateLimitHeaders !== false ? buildRateLimitHeaders(rlResult) : undefined;
        return errJson(withMeta({ code: "RATE_LIMITED", message: "Too many requests", status: 429 }), { headers });
      }

      // 7. Payload
      let payload: unknown;
      if (isPost) {
        const body = await parseBody(req, opts.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES);
        if (!body.ok) return errJson(withMeta(body.error));
        payload = body.value;
      } else {
        const queryBytes = new TextEncoder().encode(req.nextUrl.search).byteLength;
        const maxQuery = opts.maxQueryBytes ?? DEFAULT_MAX_QUERY_BYTES;
        if (queryBytes > maxQuery) {
          return errJson(withMeta({ code: "QUERY_STRING_TOO_LARGE", message: "Query string too large", status: 414, meta: { maxBytes: maxQuery, actualBytes: queryBytes } }));
        }
        payload = Object.fromEntries(req.nextUrl.searchParams.entries());
      }

      // 8. Schema validation
      const validated = await validateWithSchema(schema, payload);
      if (!validated.ok) return errJson(withMeta(validated.error));

      // 9. Idempotency key
      let idempotencyKey: string | null = null;
      if (opts.requireIdempotency && isPost) {
        try {
          idempotencyKey = requireIdempotencyKey(req);
        } catch (e) {
          const parsed = ErrorWithStatusSchema.safeParse(e);
          const message = parsed.success ? parsed.data.message : "Idempotency-Key required";
          const status = parsed.success ? parsed.data.status : 400;
          return errJson(withMeta({ code: "IDEMPOTENCY_REQUIRED", message, status }));
        }
      } else {
        idempotencyKey = req.headers.get("idempotency-key") ?? req.headers.get("Idempotency-Key") ?? null;
      }

      // 10. If-Match header
      const ifMatch = req.headers.get("if-match");

      // Execute handler
      return await handler({
        req,
        session,
        viewerId,
        handle,
        json: validated.value,
        idempotencyKey,
        ifMatch,
        requestId,
        authMode,
      });
    } catch (e) {
      // Unexpected error — log and return clean 500
      console.error("[api] Unexpected error:", e);
      return errJson(withMeta({ code: "INTERNAL_ERROR", message: "Internal server error", status: 500 }));
    }
  };
}
