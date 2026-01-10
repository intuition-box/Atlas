import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Cookie helpers (server-only)
 *
 * Goals:
 * - One small, consistent place to read/set/clear cookies in route handlers.
 * - Safe defaults: httpOnly + SameSite=Lax + Path=/ + Secure in production.
 * - Avoid env toggles and magic behavior.
 */

export type SameSite = "lax" | "strict" | "none";

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSite;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
};

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Default options for app cookies.
 *
 * - httpOnly: true
 * - sameSite: lax (safe default for most web apps)
 * - secure: production only (dev http cannot set secure cookies)
 * - path: /
 */
export function defaultCookieOptions(): Required<
  Pick<CookieOptions, "httpOnly" | "secure" | "sameSite" | "path">
> {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
  };
}

/**
 * Make a __Host- cookie name in production for stronger scoping.
 * In dev we return the base name because __Host- requires Secure.
 */
export function hostCookieName(base: string): string {
  const b = base.trim();
  if (!b) throw new Error("Cookie base name is required");
  return isProd() ? `__Host-${b}` : b;
}

/** Read a cookie value from a NextRequest. */
export function getCookie(req: NextRequest, name: string): string | null {
  return req.cookies.get(name)?.value ?? null;
}

/**
 * Set a cookie on a NextResponse.
 *
 * Note: In Next.js, cookies must be set on the response object you return.
 */
export function setCookie(
  res: NextResponse,
  name: string,
  value: string,
  opts?: CookieOptions,
): void {
  const d = defaultCookieOptions();
  res.cookies.set(name, value, {
    httpOnly: opts?.httpOnly ?? d.httpOnly,
    secure: opts?.secure ?? d.secure,
    sameSite: opts?.sameSite ?? d.sameSite,
    path: opts?.path ?? d.path,
    domain: opts?.domain,
    maxAge: opts?.maxAge,
    expires: opts?.expires,
  });
}

/**
 * Clear a cookie by setting it to empty with maxAge=0.
 */
export function clearCookie(res: NextResponse, name: string, opts?: CookieOptions): void {
  const d = defaultCookieOptions();
  res.cookies.set(name, "", {
    httpOnly: opts?.httpOnly ?? d.httpOnly,
    secure: opts?.secure ?? d.secure,
    sameSite: opts?.sameSite ?? d.sameSite,
    path: opts?.path ?? d.path,
    domain: opts?.domain,
    maxAge: 0,
  });
}

/**
 * Convenience: set a token-style cookie (httpOnly + lax + secure-in-prod + path=/).
 */
export function setTokenCookie(
  res: NextResponse,
  name: string,
  token: string,
  opts?: Omit<CookieOptions, "httpOnly">,
): void {
  setCookie(res, name, token, { ...opts, httpOnly: true });
}
