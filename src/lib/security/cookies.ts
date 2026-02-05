import "server-only";

import crypto from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Cookie helpers (server-only)
 *
 * Goals:
 * - One small, consistent place to read/set/clear cookies in route handlers.
 * - Safe defaults: httpOnly + SameSite=Lax + Path=/ + Secure in production.
 * - Avoid env toggles and magic behavior.
 * - Encrypted cookie support for sensitive data.
 * - CHIPS (Partitioned) support for third-party contexts.
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
  /**
   * CHIPS (Cookies Having Independent Partitioned State) support.
   * When true, the cookie is partitioned by top-level site.
   * Required for cookies in third-party/embedded contexts (Chrome 114+).
   * @see https://developer.chrome.com/docs/privacy-sandbox/chips/
   */
  partitioned?: boolean;
};

export function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

// ============================================================================
// Cryptographic Helpers
// ============================================================================

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Returns false if lengths differ (but still constant-time for equal lengths).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ============================================================================
// Encryption Helpers
// ============================================================================

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Current encryption version. Increment when changing encryption scheme.
 * Stored as first byte of encrypted payload for future key rotation support.
 */
const ENCRYPTION_VERSION = 0x01;

/**
 * Context strings for HKDF key derivation.
 * Using different contexts ensures derived keys are domain-separated.
 */
const HKDF_SALT = "orbyt-cookie-encryption-v1";
const HKDF_INFO = "cookie-aes-256-gcm";

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for encrypted cookies");
  }
  return secret;
}

/**
 * Derive encryption key using HKDF (HMAC-based Key Derivation Function).
 * This is cryptographically stronger than raw SHA-256 hashing.
 */
function deriveEncryptionKey(): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      getAuthSecret(),
      HKDF_SALT,
      HKDF_INFO,
      KEY_LENGTH,
    ),
  );
}

/**
 * Encrypt a value using AES-256-GCM.
 * Returns: base64url(version || iv || ciphertext || authTag)
 *
 * Format (versioned for future key rotation):
 * - Byte 0: Version (0x01)
 * - Bytes 1-12: IV (96 bits)
 * - Bytes 13-N: Ciphertext
 * - Last 16 bytes: Auth tag (128 bits)
 */
function encrypt(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Concatenate: version || iv || ciphertext || authTag
  const combined = Buffer.concat([
    Buffer.from([ENCRYPTION_VERSION]),
    iv,
    encrypted,
    authTag,
  ]);
  return combined.toString("base64url");
}

/**
 * Decrypt a value encrypted with encrypt().
 * Returns null if decryption fails (tampered, wrong key, unsupported version, etc.).
 */
function decrypt(ciphertext: string): string | null {
  try {
    const combined = Buffer.from(ciphertext, "base64url");

    // Minimum length: version (1) + iv (12) + at least 1 byte ciphertext + auth tag (16)
    if (combined.length < 1 + IV_LENGTH + 1 + AUTH_TAG_LENGTH) {
      return null;
    }

    const version = combined[0];
    if (version !== ENCRYPTION_VERSION) {
      // Unsupported version — could add migration logic here for key rotation
      return null;
    }

    const key = deriveEncryptionKey();
    const iv = combined.subarray(1, 1 + IV_LENGTH);
    const authTag = combined.subarray(-AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(1 + IV_LENGTH, -AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch {
    return null; // Decryption failed (tampered, wrong key, etc.)
  }
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
    partitioned: opts?.partitioned,
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

// ============================================================================
// Encrypted Cookie Helpers
// ============================================================================

/**
 * Set an encrypted cookie.
 *
 * Use this for sensitive data that needs confidentiality beyond httpOnly.
 * The value is encrypted with AES-256-GCM using AUTH_SECRET.
 *
 * @example
 * setEncryptedCookie(res, "sensitive-data", JSON.stringify({ userId: "123" }));
 */
export function setEncryptedCookie(
  res: NextResponse,
  name: string,
  value: string,
  opts?: CookieOptions,
): void {
  const encrypted = encrypt(value);
  setCookie(res, name, encrypted, { ...opts, httpOnly: true });
}

/**
 * Read and decrypt an encrypted cookie.
 *
 * Returns null if the cookie is missing, tampered, or decryption fails.
 *
 * @example
 * const data = getEncryptedCookie(req, "sensitive-data");
 * if (data) {
 *   const parsed = JSON.parse(data);
 * }
 */
export function getEncryptedCookie(req: NextRequest, name: string): string | null {
  const raw = getCookie(req, name);
  if (!raw) return null;
  return decrypt(raw);
}

/**
 * Clear an encrypted cookie (same as clearCookie, but named for symmetry).
 */
export function clearEncryptedCookie(
  res: NextResponse,
  name: string,
  opts?: CookieOptions,
): void {
  clearCookie(res, name, opts);
}
