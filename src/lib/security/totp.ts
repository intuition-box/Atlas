import "server-only";

import crypto from "node:crypto";

import type { ApiError, Result } from "@/lib/api/shapes";
import { err, ok } from "@/lib/api/shapes";

/**
 * TOTP (RFC 6238) + Base32 (RFC 4648)
 *
 * - Base32 decoding is included because TOTP secrets are commonly encoded that way.
 * - No env toggles, no hidden behavior.
 * - All helpers are server-only.
 */

// ---------------------------------------------------------------------------
// RFC 4648 Base32 decoder (for TOTP secrets)
// ---------------------------------------------------------------------------

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const B32_REV: Int16Array = (() => {
  const t = new Int16Array(128);
  t.fill(-1);
  for (let i = 0; i < B32_ALPHABET.length; i++) {
    t[B32_ALPHABET.charCodeAt(i)] = i;
  }
  for (let i = 0; i < 26; i++) {
    t["a".charCodeAt(0) + i] = t["A".charCodeAt(0) + i];
  }
  return t;
})();

export type Base32ErrorCode = "BASE32_INVALID";

export type Base32InvalidReason =
  | "EMPTY"
  | "INVALID_CHAR"
  | "INVALID_PADDING"
  | "INVALID_LENGTH";

export type Base32Problem = ApiError<
  Base32ErrorCode,
  400,
  { reason: Base32InvalidReason; index?: number; char?: string }
>;

export type Base32Result<T> = Result<T, Base32Problem>;

function base32Problem(
  reason: Base32InvalidReason,
  message: string,
  meta?: { index?: number; char?: string },
): Base32Problem {
  return { code: "BASE32_INVALID", message, status: 400, meta: { reason, ...meta } };
}

function isIgnorableBase32Char(ch: string): boolean {
  // Common separators users paste into TOTP secrets.
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "-";
}

/** Decode an RFC 4648 base32 string into bytes. */
export function decodeBase32(input: string): Base32Result<Uint8Array> {
  const s = input.trim();
  if (s.length === 0) return err(base32Problem("EMPTY", "Secret is required"));

  let sigCount = 0;
  let seenPadding = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isIgnorableBase32Char(ch)) continue;

    if (ch === "=") {
      seenPadding = true;
      continue;
    }

    if (seenPadding) {
      return err(base32Problem("INVALID_PADDING", "Invalid padding", { index: i, char: ch }));
    }

    const code = ch.charCodeAt(0);
    if (code >= 128 || B32_REV[code] === -1) {
      return err(base32Problem("INVALID_CHAR", "Invalid base32 character", { index: i, char: ch }));
    }

    sigCount++;
  }

  if (sigCount === 0) return err(base32Problem("EMPTY", "Secret is required"));

  // Valid unpadded base32 lengths modulo 8 are: 0,2,4,5,7.
  const rem = sigCount % 8;
  if (!(rem === 0 || rem === 2 || rem === 4 || rem === 5 || rem === 7)) {
    return err(base32Problem("INVALID_LENGTH", "Invalid base32 length"));
  }

  const outLen = Math.floor((sigCount * 5) / 8);
  const out = new Uint8Array(outLen);

  let buffer = 0;
  let bits = 0;
  let outPos = 0;
  let paddingOnly = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isIgnorableBase32Char(ch)) continue;

    if (ch === "=") {
      paddingOnly = true;
      continue;
    }

    if (paddingOnly) {
      return err(base32Problem("INVALID_PADDING", "Invalid padding", { index: i, char: ch }));
    }

    const v = B32_REV[ch.charCodeAt(0)];
    buffer = (buffer << 5) | v;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      out[outPos++] = (buffer >> bits) & 0xff;
    }
  }

  return ok(out);
}

export function decodeBase32ToBuffer(input: string): Base32Result<Buffer> {
  const r = decodeBase32(input);
  if (!r.ok) return r;
  return ok(Buffer.from(r.value));
}

// ---------------------------------------------------------------------------
// HOTP/TOTP
// ---------------------------------------------------------------------------

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type TotpErrorCode = "TOTP_INVALID_SECRET" | "TOTP_INVALID_TOKEN";

export type TotpProblem = ApiError<
  TotpErrorCode,
  400,
  { reason: "EMPTY" | "FORMAT" | "OUT_OF_RANGE" | "DECODE" }
>;

export type TotpResult<T> = Result<T, TotpProblem>;

function totpProblem(code: TotpErrorCode, reason: NonNullable<TotpProblem["meta"]>["reason"], message: string): TotpProblem {
  return { code, status: 400, message, meta: { reason } };
}

function algoNodeName(a: TotpAlgorithm): string {
  // Node expects lowercase algorithm names.
  return a.toLowerCase();
}

function counterToBuffer(counter: bigint): Buffer {
  const b = Buffer.alloc(8);
  // Big-endian.
  b.writeBigUInt64BE(counter);
  return b;
}

function dynamicTruncate(hmac: Buffer): number {
  const offset = hmac[hmac.length - 1] & 0x0f;
  const p = hmac.readUInt32BE(offset) & 0x7fffffff;
  return p;
}

function pow10(n: number): number {
  // Digits are small (6-8), so this is safe.
  let x = 1;
  for (let i = 0; i < n; i++) x *= 10;
  return x;
}

/**
 * HOTP (RFC 4226)
 */
export function hotp(args: {
  secret: Buffer;
  counter: bigint;
  digits?: number;
  algorithm?: TotpAlgorithm;
}): string {
  const digits = args.digits ?? 6;
  const algorithm = args.algorithm ?? "SHA1";

  const msg = counterToBuffer(args.counter);
  const mac = crypto.createHmac(algoNodeName(algorithm), args.secret).update(msg).digest();
  const code = dynamicTruncate(mac) % pow10(digits);

  return String(code).padStart(digits, "0");
}

/**
 * TOTP (RFC 6238)
 */
export function totp(args: {
  secret: Buffer;
  timeMs?: number;
  period?: number;
  digits?: number;
  algorithm?: TotpAlgorithm;
}): string {
  const period = args.period ?? 30;
  const timeMs = args.timeMs ?? Date.now();
  const counter = BigInt(Math.floor(timeMs / 1000 / period));

  return hotp({
    secret: args.secret,
    counter,
    digits: args.digits ?? 6,
    algorithm: args.algorithm ?? "SHA1",
  });
}

function normalizeToken(token: string): string {
  // Users often paste tokens with spaces.
  return token.replace(/\s+/g, "").trim();
}

function isNumericToken(token: string, digits: number): boolean {
  if (token.length !== digits) return false;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/**
 * Verify a user-provided TOTP token.
 *
 * - `window` allows drift (number of periods to check before/after current).
 */
export function verifyTotp(args: {
  secretBase32: string;
  token: string;
  timeMs?: number;
  period?: number;
  digits?: number;
  algorithm?: TotpAlgorithm;
  window?: number;
}): TotpResult<boolean> {
  const digits = args.digits ?? 6;
  const period = args.period ?? 30;
  const algorithm = args.algorithm ?? "SHA1";
  const window = args.window ?? 1;

  const rawToken = normalizeToken(args.token);
  if (rawToken.length === 0) {
    return err(totpProblem("TOTP_INVALID_TOKEN", "EMPTY", "Token is required"));
  }

  if (!Number.isInteger(digits) || digits < 6 || digits > 10) {
    return err(totpProblem("TOTP_INVALID_TOKEN", "OUT_OF_RANGE", "Invalid digits"));
  }

  if (!isNumericToken(rawToken, digits)) {
    return err(totpProblem("TOTP_INVALID_TOKEN", "FORMAT", "Invalid token"));
  }

  const dec = decodeBase32ToBuffer(args.secretBase32);
  if (!dec.ok) {
    return err(totpProblem("TOTP_INVALID_SECRET", "DECODE", "Invalid secret"));
  }

  const timeMs = args.timeMs ?? Date.now();
  const step = Math.floor(timeMs / 1000 / period);

  for (let w = -window; w <= window; w++) {
    const counter = BigInt(step + w);
    const expected = hotp({ secret: dec.value, counter, digits, algorithm });
    // Timing-safe compare is not critical here (short numeric strings), but easy to do.
    const a = Buffer.from(expected);
    const b = Buffer.from(rawToken);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return ok(true);
  }

  return ok(false);
}

/**
 * Build an otpauth:// URL for authenticator apps.
 */
export function buildOtpauthUrl(args: {
  issuer: string;
  accountLabel: string;
  secretBase32: string;
  algorithm?: TotpAlgorithm;
  digits?: number;
  period?: number;
}): TotpResult<string> {
  const issuer = args.issuer.trim();
  const label = args.accountLabel.trim();
  const secret = args.secretBase32.trim();

  if (!issuer || !label || !secret) {
    return err(totpProblem("TOTP_INVALID_SECRET", "EMPTY", "Missing issuer, label, or secret"));
  }

  // Validate secret (decode only; we don't need bytes here).
  const dec = decodeBase32(secret);
  if (!dec.ok) {
    return err(totpProblem("TOTP_INVALID_SECRET", "DECODE", "Invalid secret"));
  }

  const algorithm = args.algorithm ?? "SHA1";
  const digits = args.digits ?? 6;
  const period = args.period ?? 30;

  const otpauthLabel = encodeURIComponent(`${issuer}:${label}`);

  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });

  return ok(`otpauth://totp/${otpauthLabel}?${params.toString()}`);
}
