import "server-only";

import crypto from "node:crypto";

import { serverEnv as env } from "@/lib/env-server";

// AES-256-GCM envelope: v1: base64url(iv).base64url(ciphertext).base64url(tag)
const ALG = "aes-256-gcm";

function getKey(): Buffer {
  // Derive a 32-byte key from AUTH_SECRET using SHA-256 (sufficient for app secrets)
  return crypto.createHash("sha256").update(env.AUTH_SECRET).digest();
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error("scrypt_invalid");
}

export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, enc, tag].map((b) => b.toString("base64url")).join(".");
}

export function decryptString(envelope: string): string {
  const [ivb64, encb64, tagb64] = envelope.split(".");
  if (!ivb64 || !encb64 || !tagb64) throw new Error("invalid_envelope");
  const iv = Buffer.from(ivb64, "base64url");
  const enc = Buffer.from(encb64, "base64url");
  const tag = Buffer.from(tagb64, "base64url");
  if (iv.length !== 12) throw new Error("invalid_envelope");
  if (tag.length !== 16) throw new Error("invalid_envelope");
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export async function scryptHashString(input: string, saltBytes = 16, keyLen = 32): Promise<string> {
  const salt = crypto.randomBytes(saltBytes);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(input, salt, keyLen, (err, dk) => (err ? reject(err) : resolve(toBuffer(dk))));
  });
  return `${salt.toString("base64url")}.${derived.toString("base64url")}`;
}

export async function scryptVerifyString(input: string, stored: string, keyLen = 32): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(input, salt, keyLen, (err, dk) => (err ? reject(err) : resolve(toBuffer(dk))));
  });
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
