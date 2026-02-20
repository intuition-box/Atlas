import "server-only";

import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";

export type RateLimitPolicyId = "api" | "auth" | "upload";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch seconds when the window resets. */
  reset: number;
  /** Seconds clients should wait before retrying (only present when blocked). */
  retryAfter?: number;
};

type Policy = {
  /** max requests per window */
  limit: number;
  /** window size in ms */
  windowMs: number;
};

const POLICIES: Record<RateLimitPolicyId, Policy> = {
  // General API traffic (authenticated and anonymous)
  api: { limit: 60, windowMs: 60_000 },
  // Login / onboarding / high-risk endpoints
  auth: { limit: 10, windowMs: 60_000 },
  // File uploads (R2 storage — stricter to prevent abuse)
  upload: { limit: 10, windowMs: 60_000 },
} as const;

type Bucket = {
  count: number;
  resetAtMs: number;
};

const MAX_BUCKETS = 10_000;
const CLEANUP_INTERVAL_MS = 30_000;

function shouldCleanup(t: number): boolean {
  const last = globalThis.__atlasRateLimitCleanupAtMs ?? 0;
  return t - last >= CLEANUP_INTERVAL_MS;
}

function noteCleanup(t: number) {
  globalThis.__atlasRateLimitCleanupAtMs = t;
}

function cleanupBuckets(store: Map<string, Bucket>, t: number) {
  // First drop expired windows.
  for (const [k, b] of store) {
    if (b.resetAtMs <= t) store.delete(k);
  }

  // If still too large, drop oldest entries (in insertion order).
  while (store.size > MAX_BUCKETS) {
    const firstKey = store.keys().next().value as string | undefined;
    if (!firstKey) break;
    store.delete(firstKey);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __atlasRateLimitBuckets: Map<string, Bucket> | undefined;
  // eslint-disable-next-line no-var
  var __atlasRateLimitCleanupAtMs: number | undefined;
}

function buckets(): Map<string, Bucket> {
  if (!globalThis.__atlasRateLimitBuckets) {
    globalThis.__atlasRateLimitBuckets = new Map();
  }
  return globalThis.__atlasRateLimitBuckets;
}

function nowMs(): number {
  return Date.now();
}

function resetEpochSeconds(resetAtMs: number): number {
  return Math.floor(resetAtMs / 1000);
}

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

function getClientIp(req: NextRequest): string {
  // Cloudflare first
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;

  // Common proxies
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  // NextRequest may have `ip` on some platforms
  const anyReq = req as unknown as { ip?: string };
  if (anyReq.ip) return anyReq.ip;

  return "unknown";
}

function hashIdentity(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/**
 * Build a stable, privacy-preserving rate limit key.
 * - If `viewerId` is present, key is user-scoped.
 * - Otherwise key is based on hashed client IP.
 */
export function getRateLimitKey(req: NextRequest, viewerId?: string): string {
  if (viewerId && viewerId.length > 0) return `u:${viewerId}`;
  const ip = getClientIp(req);
  return `ip:${hashIdentity(ip)}`;
}

/**
 * Compute a fixed-window rate limit decision.
 *
 * Note: this implementation is per-process. In serverless/multi-instance deployments,
 * use a shared store (Redis/Upstash/etc.) behind this interface.
 */
export async function rateLimit(args: {
  key: string;
  policyId: string;
}): Promise<RateLimitDecision> {
  const policy = (POLICIES as Record<string, Policy>)[args.policyId] ?? POLICIES.api;

  const bucketKey = `${args.policyId}:${args.key}`;
  const store = buckets();

  const t = nowMs();
  if (store.size > MAX_BUCKETS && shouldCleanup(t)) {
    cleanupBuckets(store, t);
    noteCleanup(t);
  }

  const existing = store.get(bucketKey);

  let b: Bucket;
  if (!existing || existing.resetAtMs <= t) {
    b = { count: 0, resetAtMs: t + policy.windowMs };
  } else {
    b = existing;
  }

  b.count += 1;
  store.set(bucketKey, b);

  const remaining = clampNonNegative(policy.limit - b.count);
  const allowed = b.count <= policy.limit;
  const reset = resetEpochSeconds(b.resetAtMs);

  if (allowed) {
    return { allowed: true, limit: policy.limit, remaining, reset };
  }

  const retryAfter = clampNonNegative(Math.ceil((b.resetAtMs - t) / 1000));
  return {
    allowed: false,
    limit: policy.limit,
    remaining: 0,
    reset,
    retryAfter,
  };
}

/**
 * Build standard rate limit headers.
 * Uses the emerging "RateLimit-*" headers and also mirrors values as X-RateLimit-*.
 */
export function buildRateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(d.limit),
    "RateLimit-Remaining": String(d.remaining),
    "RateLimit-Reset": String(d.reset),
    "X-RateLimit-Limit": String(d.limit),
    "X-RateLimit-Remaining": String(d.remaining),
    "X-RateLimit-Reset": String(d.reset),
  };

  if (!d.allowed && typeof d.retryAfter === "number") {
    h["Retry-After"] = String(d.retryAfter);
  }

  return h;
}
