import "server-only";

import crypto from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearCookie,
  getCookie,
  hostCookieName,
  setCookie,
  timingSafeEqual,
} from "@/lib/security/cookies";

/**
 * MFA “remember device” cookie
 *
 * This is domain logic (signed token + cookie), intentionally separate from generic cookie helpers.
 *
 * - The cookie stores a signed, expiring token identifying a user + device.
 * - Use it to skip MFA challenges on trusted devices.
 * - Never store secrets or PII beyond opaque IDs.
 */

const REMEMBER_COOKIE_BASE = "atlas-mfa";
export const REMEMBER_COOKIE_NAME = hostCookieName(REMEMBER_COOKIE_BASE);

const DEFAULT_TTL_DAYS = 30;

type RememberClaims = {
  uid: string;
  did: string;
  iat: number; // unix seconds
  exp: number; // unix seconds
};

function isRememberClaims(v: unknown): v is RememberClaims {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.uid === "string" &&
    o.uid.length > 0 &&
    typeof o.did === "string" &&
    o.did.length > 0 &&
    typeof o.iat === "number" &&
    Number.isFinite(o.iat) &&
    typeof o.exp === "number" &&
    Number.isFinite(o.exp)
  );
}

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required for MFA remember-device tokens");
  return s;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function base64urlDecode(s: string): Buffer {
  // Node supports base64url in recent versions; keep explicit for clarity.
  return Buffer.from(s, "base64url");
}

function sign(data: string): string {
  return crypto.createHmac("sha256", authSecret()).update(data).digest("base64url");
}

function encodeClaims(claims: RememberClaims): string {
  const json = JSON.stringify(claims);
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function decodeClaims(token: string): RememberClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = sign(payload);
  if (!timingSafeEqual(sig, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(base64urlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }

  if (!isRememberClaims(claims)) return null;

  const c = claims;
  if (c.exp <= nowSec()) return null;

  return c;
}

export type RememberDevice = {
  userId: string;
  deviceId: string;
};

/**
 * Read the remember-device cookie from a request.
 * Returns null when missing/invalid/expired.
 */
export function readRememberDevice(req: NextRequest): RememberDevice | null {
  const token = getCookie(req, REMEMBER_COOKIE_NAME);
  if (!token) return null;

  const claims = decodeClaims(token);
  if (!claims) return null;

  return { userId: claims.uid, deviceId: claims.did };
}

/**
 * Issue (or refresh) a remember-device cookie.
 */
export function issueRememberDevice(
  res: NextResponse,
  args: { userId: string; deviceId: string; ttlDays?: number },
): void {
  const ttlDays = args.ttlDays ?? DEFAULT_TTL_DAYS;
  const ttlSec = Math.max(1, Math.floor(ttlDays * 24 * 60 * 60));

  const iat = nowSec();
  const exp = iat + ttlSec;

  const token = encodeClaims({ uid: args.userId, did: args.deviceId, iat, exp });

  setCookie(res, REMEMBER_COOKIE_NAME, token, {
    // Token is opaque; keep it httpOnly.
    httpOnly: true,
    // Align with our CSRF posture.
    sameSite: "lax",
    // Max-Age in seconds.
    maxAge: ttlSec,
  });
}

/**
 * Clear the remember-device cookie.
 */
export function clearRememberDevice(res: NextResponse): void {
  clearCookie(res, REMEMBER_COOKIE_NAME, { httpOnly: true, sameSite: "lax" });
}
