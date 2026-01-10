

import "server-only";

import type { NextRequest } from "next/server";

/**
 * Idempotency-Key helpers.
 *
 * This module is intentionally small: it only extracts and validates the header.
 * Persistence / replay protection lives at the route/service layer.
 */

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key" as const;

function normalize(v: string): string {
  return v.trim();
}

function isValidKey(v: string): boolean {
  // Keep validation permissive but safe.
  // - no empty
  // - reasonable length
  // - restrict to visible ASCII tokens commonly used for UUIDs / hashes
  if (v.length < 8) return false;
  if (v.length > 128) return false;

  // Allow: A-Z a-z 0-9 and a small safe set of separators.
  // Disallow whitespace and control chars.
  return /^[A-Za-z0-9._:-]+$/.test(v);
}

/**
 * Reads the Idempotency-Key header if present.
 */
export function getIdempotencyKey(req: NextRequest): string | null {
  const raw = req.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (!raw) return null;

  const key = normalize(raw);
  return key.length > 0 ? key : null;
}

/**
 * Requires a valid Idempotency-Key header and returns it.
 *
 * Throws an Error with a `cause.status` so callers can map it to API envelopes.
 */
export function requireIdempotencyKey(req: NextRequest): string {
  const key = getIdempotencyKey(req);
  if (!key) {
    throw new Error("Idempotency-Key required", { cause: { status: 428 } });
  }

  if (!isValidKey(key)) {
    throw new Error("Invalid Idempotency-Key", { cause: { status: 400 } });
  }

  return key;
}