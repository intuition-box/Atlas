import "server-only";

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import type { ApiResponse } from "@/types/api";

/** Dev-only: allow insecure cookies (no __Host- and no Secure) when explicitly enabled */
function devInsecureCookies(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_DEV_INSECURE_COOKIES === "true";
}

/** Optional stricter mode: when Origin is missing, also require Referer host to match */
function requireRefererWhenNoOrigin(): boolean {
  return process.env.CSRF_REQUIRE_REFERER === "true";
}

/** Constant-time string comparison */
function safeEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** CSRF cookie/header naming */
export const CSRF_COOKIE = "__Host-orbyt.csrf"; // __Host- prefix requires Secure + Path=/ and no Domain
export const CSRF_HEADER = "x-csrf-token"; // case-insensitive

/** Dev fallback cookie name used only when NEXT_DEV_INSECURE_COOKIES=true (non-production) */
export const CSRF_COOKIE_DEV = "orbyt.csrf";

/** Resolve the active cookie name depending on environment flags */
export function getCsrfCookieName(): string {
  return devInsecureCookies() ? CSRF_COOKIE_DEV : CSRF_COOKIE;
}

/** Optional escape hatch for tests/local tools */
function csrfDisabled(): boolean {
  // Only allow disabling CSRF checks outside production explicitly
  return process.env.NODE_ENV !== "production" && process.env.CSRF_DISABLE === "true";
}

/** Generate a cryptographically strong, URL-safe token */
export function generateCsrfToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Set the CSRF cookie on a response.
 * We use __Host- prefix: requires `Secure`, `Path=/`, and no `Domain` attribute.
 * We keep it HttpOnly so scripts cannot read it; clients obtain the token from an endpoint response body instead.
 */
export function setCsrfCookie(res: NextResponse, token: string, maxAgeSeconds = 60 * 60 * 24 /* 24h */): void {
  const name = getCsrfCookieName();
  const parts = [
    `${name}=${token}`,
    "Path=/",
    "SameSite=Strict",
    "HttpOnly",
    "Priority=High",
    `Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`,
  ];
  // Only include Secure when not in dev-insecure mode
  if (!devInsecureCookies()) parts.splice(2, 0, "Secure");
  res.headers.append("Set-Cookie", parts.join("; "));
}

/** Clear the CSRF cookie (useful on logout) */
export function clearCsrfCookie(res: NextResponse): void {
  const names = [CSRF_COOKIE, CSRF_COOKIE_DEV];
  for (const name of names) {
    const parts = [
      `${name}=`,
      "Path=/",
      "SameSite=Strict",
      "HttpOnly",
      "Priority=High",
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ];
    // Include Secure attribute only on the strict __Host- cookie
    if (name.startsWith("__Host-")) parts.splice(2, 0, "Secure");
    res.headers.append("Set-Cookie", parts.join("; "));
  }
}

/** Return the CSRF cookie value from the incoming request, if present */
export function getCsrfCookie(req: NextRequest): string | null {
  const primary = getCsrfCookieName();
  const alternates = primary === CSRF_COOKIE ? [CSRF_COOKIE_DEV] : [CSRF_COOKIE];

  // Try framework cookie accessor first
  try {
    const value = req.cookies.get(primary)?.value;
    if (value) return value;
    for (const alt of alternates) {
      const altVal = req.cookies.get(alt)?.value;
      if (altVal) return altVal;
    }
  } catch {
    // ignore
  }

  // Fallback: parse Cookie header manually
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const pairs = raw.split(";").map((s) => s.trim());
  const findCookie = (name: string) =>
    pairs.find((p) => p.startsWith(`${name}=`))?.substring(name.length + 1);

  const found = findCookie(primary) ?? alternates.map(findCookie).find(Boolean);
  return found ? decodeURIComponent(found) : null;
}

/** Extract host portion of a URL string */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Determine whether request comes from same-origin */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const xfHost = req.headers.get("x-forwarded-host");
  const host = xfHost || req.headers.get("host");
  const hostOk = !!host;

  // If Origin is present, it must match host
  if (origin) {
    const originHost = hostOf(origin);
    return !!originHost && hostOk && originHost === host;
  }

  // Non-browser/CLI cases: if not requiring Referer, allow
  if (!requireRefererWhenNoOrigin()) return true;

  // Strict mode: require Referer host to match too
  const ref = req.headers.get("referer");
  if (!ref || !hostOk) return false;
  const refHost = hostOf(ref);
  return !!refHost && refHost === host;
}

type HttpError = Error & { status: number };

/** Throws a 403 error object suitable for route handlers */
function throwCsrf(message = "CSRF verification failed"): never {
  const err = new Error(message) as HttpError;
  err.name = "CsrfError";
  err.status = 403;
  throw err;
}

/**
 * Verify CSRF for non-GET requests using double-submit (cookie + header) and same-origin check.
 * - Header `X-CSRF-Token` must equal cookie `__Host-orbyt.csrf`.
 * - Origin must match Host when `Origin` header is present.
 *
 * Returns the token value on success (for logging if needed).
 */
export function requireCsrf(req: NextRequest): string {
  if (csrfDisabled()) return "__csrf_disabled__";

  const method = req.method?.toUpperCase?.() || "GET";
  // Only enforce on unsafe methods
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "__csrf_skipped__";

  if (!isSameOrigin(req)) throwCsrf("Cross-origin request not allowed");

  const headerToken = req.headers.get(CSRF_HEADER) || req.headers.get("X-CSRF-Token");
  if (!headerToken) throwCsrf(`Missing ${CSRF_HEADER} header`);

  const cookieToken = getCsrfCookie(req);
  if (!cookieToken) throwCsrf("Missing CSRF cookie");

  if (!safeEqual(headerToken, cookieToken)) throwCsrf("CSRF token mismatch");

  return headerToken;
}

/**
 * Issue a new CSRF token and set cookie on the provided response.
 * Returns the token so the caller can also include it in the JSON payload for clients.
 */
export function issueCsrf(res: NextResponse, opts?: { maxAgeSeconds?: number; tokenBytes?: number }): string {
  const token = generateCsrfToken(opts?.tokenBytes ?? 32);
  setCsrfCookie(res, token, opts?.maxAgeSeconds);
  return token;
}

/** Recommended headers for the /api/security/csrf route */
export function applyCsrfRouteHeaders(res: NextResponse): void {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  res.headers.append("Vary", "Cookie");
  // Defensive: prevent framing
  res.headers.set("X-Frame-Options", "DENY");
}

/**
 * Build a JSON ApiResponse including a fresh CSRF token, set the cookie on the same response,
 * and apply standard CSRF route headers. Keeps route handlers tiny and consistent.
 *
 * Usage:
 *   return jsonWithCsrfToken(({ token }) => ({ token }));
 */
export function jsonWithCsrfToken<T>(
  build: (ctx: { token: string }) => T,
  init?: ResponseInit,
  opts?: { maxAgeSeconds?: number; tokenBytes?: number },
): NextResponse {
  const token = generateCsrfToken(opts?.tokenBytes ?? 32);
  const res = NextResponse.json<ApiResponse<T>>(
    { success: true, data: build({ token }) },
    init ?? { status: 200 },
  );
  setCsrfCookie(res, token, opts?.maxAgeSeconds ?? 60 * 60 * 24);
  applyCsrfRouteHeaders(res);
  return res;
}