import "server-only";

import crypto from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ApiEnvelope, ApiError, Result } from "@/lib/api/shapes";
import { err, apiErr, ok, apiOk } from "@/lib/api/shapes";

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

export const CSRF_HEADER_NAME = "X-CSRF-Token";
export const CSRF_REFRESH_HEADER_NAME = "X-CSRF-Token-Refresh";

const CSRF_COOKIE_NAME_PROD = "__Host-orbyt-csrf";
const CSRF_COOKIE_NAME_DEV = "orbyt-csrf";

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function csrfCookieName(): string {
  return isProd() ? CSRF_COOKIE_NAME_PROD : CSRF_COOKIE_NAME_DEV;
}

export type CsrfErrorCode = "CSRF_INVALID" | "CSRF_ORIGIN";

export type CsrfProblem = ApiError<CsrfErrorCode, 403>;
export type CsrfResult<T> = Result<T, CsrfProblem>;

export type CsrfResponse = {
  csrfToken: string;
};

function cookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
} {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
  };
}

function isUnsafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requestOrigin(req: NextRequest): string {
  return req.nextUrl.origin;
}

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

export function issueCsrfToken(): string {
  // 32 bytes entropy; base64url is header-safe.
  return crypto.randomBytes(32).toString("base64url");
}

export function getCsrfCookie(req: NextRequest): string | null {
  return req.cookies.get(csrfCookieName())?.value ?? null;
}

export function getCsrfHeader(req: NextRequest): string | null {
  return req.headers.get(CSRF_HEADER_NAME);
}

export function setCsrfCookie(res: NextResponse, token: string): void {
  res.cookies.set(csrfCookieName(), token, cookieOptions());
}

export function clearCsrfCookie(res: NextResponse): void {
  res.cookies.set(csrfCookieName(), "", { ...cookieOptions(), maxAge: 0 });
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