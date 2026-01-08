import "server-only";

import crypto from "node:crypto";

// Minimal base32 (RFC 4648) decoder for TOTP secrets; ignores padding.
// Accepts uppercase/lowercase input and strips whitespace.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const cleaned = String(input ?? "")
    .replace(/=+$/g, "")
    .toUpperCase()
    .replace(/\s+/g, "");

  let bitBuf = 0;
  let bitCount = 0;
  const out: number[] = [];

  for (const c of cleaned) {
    const val = ALPHABET.indexOf(c);
    if (val === -1) throw new Error("invalid_base32");

    bitBuf = (bitBuf << 5) | val;
    bitCount += 5;

    while (bitCount >= 8) {
      bitCount -= 8;
      out.push((bitBuf >> bitCount) & 0xff);
    }
  }

  return Buffer.from(out);
}

export type TotpOptions = {
  secretBase32: string;
  period?: number; // seconds
  digits?: number; // 6 or 8
  algorithm?: "SHA1" | "SHA256" | "SHA512";
};

function hotp(key: Buffer, counter: bigint, algo: "SHA1" | "SHA256" | "SHA512"): number {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);

  const hmac = crypto.createHmac(algo.toLowerCase(), key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return code;
}

export function generateTotp(
  { secretBase32, period = 30, digits = 6, algorithm = "SHA1" }: TotpOptions,
  forTime?: number,
): string {
  if (!Number.isFinite(period) || period <= 0) throw new Error("invalid_period");
  if (digits !== 6 && digits !== 8) throw new Error("invalid_digits");

  const key = base32Decode(secretBase32);
  const t = Math.floor((forTime ?? Date.now()) / 1000);
  const counter = BigInt(Math.floor(t / period));
  const code = hotp(key, counter, algorithm);

  const mod = 10 ** digits;
  const otp = code % mod;
  return String(otp).padStart(digits, "0");
}

export function verifyTotp(
  opts: TotpOptions & { window?: number },
  token: string,
  now?: number,
): boolean {
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  if (!Number.isFinite(period) || period <= 0) return false;
  if (digits !== 6 && digits !== 8) return false;

  const t = Math.floor((now ?? Date.now()) / 1000);
  const window = Math.max(0, Math.min(10, opts.window ?? 1)); // +/- periods drift tolerance

  const normalized = String(token ?? "").trim();
  if (normalized.length !== digits) return false;
  if (!/^[0-9]+$/.test(normalized)) return false;

  for (let w = -window; w <= window; w++) {
    const time = (t + w * period) * 1000;
    const gen = generateTotp({ ...opts, period, digits }, time);
    if (safeEqual(gen, normalized)) return true;
  }

  return false;
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function buildOtpauthUrl(opts: TotpOptions & { label: string; issuer?: string }): string {
  const query = new URLSearchParams({
    secret: opts.secretBase32,
    period: String(opts.period ?? 30),
    digits: String(opts.digits ?? 6),
    algorithm: String(opts.algorithm ?? "SHA1"),
  });

  if (opts.issuer) query.set("issuer", opts.issuer);

  return `otpauth://totp/${encodeURIComponent(opts.label)}?${query.toString()}`;
}
