import "server-only";

import crypto from "node:crypto";

/**
 * Crypto helpers (server-only)
 *
 * Purpose:
 * - Small, consistent wrappers for common security needs.
 * - Encrypt-at-rest for recoverable secrets (e.g., TOTP secret).
 * - One-way hashing for secrets that should never be recovered (e.g., backup codes).
 *
 * Notes:
 * - Encryption key is derived from AUTH_SECRET.
 * - Rotating AUTH_SECRET will make previously encrypted payloads undecryptable.
 */

const ENC_VERSION = "v1";
const ENC_ALG = "aes-256-gcm";
const ENC_IV_BYTES = 12; // recommended for GCM
const ENC_TAG_BYTES = 16;

const SCRYPT_VERSION = "v1";
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 32;

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required");
  return s;
}

function deriveKey(): Buffer {
  // Derive a 32-byte key from AUTH_SECRET.
  return crypto.createHash("sha256").update(authSecret(), "utf8").digest();
}

function timingSafeEqualBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function b64u(buf: Buffer): string {
  return buf.toString("base64url");
}

function unb64u(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/**
 * SHA-256 hash (base64url). Useful for storing token hashes.
 */
export function sha256Base64url(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("base64url");
}

/**
 * Encrypt a UTF-8 string using AES-256-GCM.
 *
 * Envelope format:
 *   v1.<iv_b64url>.<ciphertext_b64url>.<tag_b64url>
 */
export function encryptString(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(ENC_IV_BYTES);

  const cipher = crypto.createCipheriv(ENC_ALG, key, iv, { authTagLength: ENC_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_VERSION}.${b64u(iv)}.${b64u(ciphertext)}.${b64u(tag)}`;
}

/**
 * Decrypt an AES-256-GCM envelope back into a UTF-8 string.
 * Returns null on invalid input, version mismatch, or auth failure.
 */
export function decryptString(envelope: string): string | null {
  const parts = envelope.split(".");
  if (parts.length !== 4) return null;

  const [ver, ivS, ctS, tagS] = parts;
  if (ver !== ENC_VERSION) return null;

  let iv: Buffer;
  let ct: Buffer;
  let tag: Buffer;
  try {
    iv = unb64u(ivS);
    ct = unb64u(ctS);
    tag = unb64u(tagS);
  } catch {
    return null;
  }

  if (iv.length !== ENC_IV_BYTES) return null;
  if (tag.length !== ENC_TAG_BYTES) return null;

  try {
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENC_ALG, key, iv, { authTagLength: ENC_TAG_BYTES });
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey as Buffer);
    });
  });
}

/**
 * Hash a string using scrypt.
 *
 * Format:
 *   v1.<salt_b64url>.<hash_b64url>
 */
export async function scryptHashString(input: string): Promise<string> {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const dk = await scryptAsync(input, salt, SCRYPT_KEY_BYTES);
  return `${SCRYPT_VERSION}.${b64u(salt)}.${b64u(dk)}`;
}

/**
 * Verify a string against a stored scrypt hash.
 */
export async function scryptVerifyString(input: string, stored: string): Promise<boolean> {
  const parts = stored.split(".");
  if (parts.length !== 3) return false;

  const [ver, saltS, hashS] = parts;
  if (ver !== SCRYPT_VERSION) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = unb64u(saltS);
    expected = unb64u(hashS);
  } catch {
    return false;
  }

  if (salt.length !== SCRYPT_SALT_BYTES) return false;
  if (expected.length !== SCRYPT_KEY_BYTES) return false;

  const actual = await scryptAsync(input, salt, expected.length);
  return timingSafeEqualBytes(actual, expected);
}
