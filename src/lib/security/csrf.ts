import "server-only";

import crypto from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ApiEnvelope, ApiError, Result } from "@/lib/api/shapes";
import { err, apiErr, ok, apiOk } from "@/lib/api/shapes";
import {
  getCookie,
  setCookie,
  clearCookie,
  hostCookieName,
  timingSafeEqual,
} from "@/lib/security/cookies";

/**
 * CSRF protection (server-only)
 *
 * We use a double-submit cookie scheme:
 * - Server sets an httpOnly CSRF cookie.
 * - Client fetches a CSRF token (JSON) and echoes it in a request header.
 * - For unsafe methods, we require:
 *   - same-origin when Origin is present
 *   - header token matches cookie token (timing-safe)
 */

// ============================================================================
// Constants
// ============================================================================

export const CSRF_HEADER_NAME = "X-CSRF-Token";
export const CSRF_REFRESH_HEADER_NAME = "X-CSRF-Token-Refresh";

/** CSRF cookie name (uses __Host- prefix in production for stronger scoping) */
export const CSRF_COOKIE_NAME = hostCookieName("atlas-csrf");

// ============================================================================
// Types
// ============================================================================

export type CsrfErrorCode = "CSRF_INVALID" | "CSRF_ORIGIN";

export type CsrfProblem = ApiError<CsrfErrorCode, 403>;
export type CsrfResult<T> = Result<T, CsrfProblem>;

export type CsrfResponse = {
  csrfToken: string;
};

// ============================================================================
// Internal Helpers
// ============================================================================

function isUnsafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

/**
 * Determine the public origin of this server, accounting for reverse proxies.
 */
function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.headers.get("host");
  if (proto && host) {
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Same-origin check.
 *
 * If Origin is missing (some clients), we do not fail solely on that basis.
 * The CSRF token match is still required.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === requestOrigin(req);
}

/** Issue a new CSRF token (32 bytes entropy, base64url encoded). */
export function issueCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Read the CSRF token from the request cookie. */
export function getCsrfCookie(req: NextRequest): string | null {
  return getCookie(req, CSRF_COOKIE_NAME);
}

/** Read the CSRF token from the request header. */
export function getCsrfHeader(req: NextRequest): string | null {
  return req.headers.get(CSRF_HEADER_NAME);
}

/** Set the CSRF token cookie on a response. */
export function setCsrfCookie(res: NextResponse, token: string): void {
  setCookie(res, CSRF_COOKIE_NAME, token);
}

/** Clear the CSRF token cookie. */
export function clearCsrfCookie(res: NextResponse): void {
  clearCookie(res, CSRF_COOKIE_NAME);
}

/**
 * Apply headers appropriate for CSRF endpoints.
 * - no-store: token endpoints should never be cached
 * - vary: origin + cookie
 * - x-frame-options: deny (defense-in-depth)
 */
export function applyCsrfRouteHeaders(res: NextResponse): void {
  res.headers.set("cache-control", "no-store");
  res.headers.set("x-frame-options", "DENY");
  res.headers.append("vary", "origin");
  res.headers.append("vary", "cookie");
}

/**
 * Issue a token and set it on the CSRF cookie.
 */
export function issueCsrf(res: NextResponse): string {
  const token = issueCsrfToken();
  setCsrfCookie(res, token);
  return token;
}

/**
 * Enforce CSRF for unsafe methods.
 */
export function requireCsrf(req: NextRequest): CsrfResult<null> {
  if (!isUnsafeMethod(req.method)) return ok(null);

  if (!isSameOrigin(req)) {
    return err({ code: "CSRF_ORIGIN", message: "Origin not allowed.", status: 403 });
  }

  const cookie = getCsrfCookie(req);
  const header = getCsrfHeader(req);

  if (!cookie || !header) {
    return err({ code: "CSRF_INVALID", message: "Missing CSRF token.", status: 403 });
  }

  if (!timingSafeEqual(cookie, header)) {
    return err({ code: "CSRF_INVALID", message: "Invalid CSRF token.", status: 403 });
  }

  return ok(null);
}

/**
 * Convenience endpoint helper: returns a fresh csrfToken in the JSON envelope
 * and sets the cookie.
 */
export function jsonWithCsrfToken(
  init?: { status?: number; headers?: HeadersInit },
): NextResponse<ApiEnvelope<CsrfResponse>> {
  const csrfToken = issueCsrfToken();

  const res = NextResponse.json(apiOk({ csrfToken }), {
    status: init?.status ?? 200,
    headers: init?.headers,
  });

  applyCsrfRouteHeaders(res);
  setCsrfCookie(res, csrfToken);
  return res;
}

/**
 * Convenience helper: return a CSRF error as an ApiEnvelope.
 */
export function csrfErrorResponse(problem: CsrfProblem): NextResponse<ApiEnvelope<never>> {
  const res = NextResponse.json(apiErr(problem), { status: problem.status });
  applyCsrfRouteHeaders(res);
  return res;
}

/**
 * Rotate the CSRF token on a successful mutation response.
 *
 * This issues a new token, sets it in the cookie, and adds it to the
 * response headers so the client can update its cached token.
 *
 * @param res - The NextResponse to modify
 * @returns The new CSRF token (for logging/debugging)
 */
export function rotateCsrfToken(res: NextResponse): string {
  const newToken = issueCsrfToken();
  setCsrfCookie(res, newToken);
  res.headers.set(CSRF_REFRESH_HEADER_NAME, newToken);
  return newToken;
}
