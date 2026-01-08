import "server-only";
/**
 * Lightweight, in-memory rate limiter (single-node, dev/local).
 * ------------------------------------------------------------------
 * ⚠️ For production (multi-region/serverless), use `redis-rate-limit.ts`.
 *
 * Features:
 *  - Sliding window per (action + callerKey)
 *  - Helper to emit standard RateLimit headers (IETF draft + common mirrors)
 */

type TimestampMs = number;

type Bucket = {
  hits: TimestampMs[]; // sorted ascending
  lastWindowMs: number;
};

// Map key: `${action}:${callerKey}`
const globalForRateLimit = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, Bucket>;
};

const buckets = globalForRateLimit.__rateLimitBuckets ?? new Map<string, Bucket>();

// Keep buckets stable across HMR in dev.
if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.__rateLimitBuckets = buckets;
}

/** Compose a caller key from available identifiers */
export function callerKey(input: { userId?: string | null; ip?: string | null; extra?: string | null }): string {
  const parts: string[] = [];
  if (input.userId) parts.push(`u:${input.userId}`);
  if (input.ip) parts.push(`ip:${input.ip}`);
  if (input.extra) parts.push(`x:${input.extra}`);
  return parts.length ? parts.join('|') : 'anon';
}

/**
 * Parse time window strings like "10s", "1m", "5m", "1h".
 * - If unit is omitted, defaults to seconds (e.g., "10" => 10s)
 * - If unparsable, falls back to 60s
 */
function parseWindow(value: string): number {
  const m = /^\s*(\d+)\s*([smh])?\s*$/i.exec(value);
  if (!m) return 60_000; // default 60s
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'm') return n * 60 * 1000;
  return n * 1000; // seconds
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms when the bucket fully drains (best-effort)
  limit: number;
  windowMs: number;
  key: string; // composed key for observability
  policyId: string; // action/policy label for headers + observability
};

export type RateLimitPolicy = {
  limit: number;
  window: string; // e.g. '10s' | '1m' | '5m' | '1h'
};

/**
 * Centralized policy registry.
 * Keep this small and explicit; add entries as new endpoints are introduced.
 */
export const RATE_LIMIT_POLICIES: Record<string, RateLimitPolicy> = {
  default: { limit: 60, window: '1m' },
  'boards.create': { limit: 10, window: '1m' },
  rpc: { limit: 120, window: '1m' },
};

export function resolveRateLimitPolicy(policyId: string): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[policyId] ?? RATE_LIMIT_POLICIES.default;
}

/** IETF draft header names */
export const RATE_LIMIT_IETF_HEADERS = {
  RATE_LIMIT: 'RateLimit',
  POLICY: 'RateLimit-Policy',
} as const;

/** Widely-used mirrors */
export const RATE_LIMIT_TRIO_HEADERS = {
  LIMIT: 'RateLimit-Limit',
  REMAINING: 'RateLimit-Remaining',
  RESET: 'RateLimit-Reset', // seconds until reset
  RETRY_AFTER: 'Retry-After',
} as const;

/** Common `X-RateLimit-*` mirrors (GitHub-style) */
export const RATE_LIMIT_X_HEADERS = {
  LIMIT: 'X-RateLimit-Limit',
  REMAINING: 'X-RateLimit-Remaining',
  RESET: 'X-RateLimit-Reset', // epoch seconds
} as const;

// ---------------------------------------------------------------------------
// Privacy-safe helpers (centralized; no raw IP leakage)
// ---------------------------------------------------------------------------

/**
 * Extract the caller's public IP from standard reverse-proxy headers.
 * Never uses adapter-specific fields (e.g., req.ip) to avoid accidental
 * leakage/logging of private addresses.
 */
export function extractClientIp(req: Request): string | undefined {
  try {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) {
      const first = fwd.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
  } catch {}
  return undefined;
}

/** Lightweight salted FNV-1a (32-bit) hash → hex (opaque; non-reversible). */
function fnv1a32(input: string): string {
  let h = 0x811c9dc5; // offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiplication via shifts
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  // unsigned 32-bit, hex padded
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build a pseudonymous identity for rate limiting from (userId, hashed-IP).
 * - Uses a secret salt so the hash is stable per deployment but opaque.
 * - We intentionally do NOT include raw IP in the composed key.
 */
export function rateLimitIdentity(req: Request, userId?: string | null): { userId?: string; extra?: string } {
  const ip = extractClientIp(req);
  // Prefer dedicated salt; fall back to AUTH_SECRET; final fallback is a dev-safe fixed value.
  const salt = (process.env.RATE_LIMIT_IP_SALT || process.env.AUTH_SECRET || 'dev-salt') as string;
  const extra = ip ? `ip:${fnv1a32(`${salt}|${ip}`)}` : undefined;
  return {
    userId: userId ?? undefined,
    extra,
  };
}

/** Preferred name in route code/docs. */
export function getClientIp(req: Request): string | undefined {
  return extractClientIp(req);
}

/**
 * Derive a stable caller key suitable for rate limiting.
 * - If userId is present: `u:<userId>` (primary)
 * - Else: a pseudonymous hashed-ip identity (no raw IP)
 */
export function getRateLimitKey(req: Request, userId?: string | null): string {
  const ids = rateLimitIdentity(req, userId);
  return callerKey({ userId: ids.userId, extra: ids.extra });
}

/**
 * Convenience wrapper: limit by (userId || hashed-IP) for a sliding window.
 * Example:
 *   const rl = await limitByRequest('boards:create', req, session?.user?.id, 1, '10m'); // uses userId or hashed-ip identity
 */
export async function limitByRequest(
  action: string,
  req: Request,
  userId: string | null | undefined,
  limit: number,
  window: string,
) {
  return limitByUserOrIp(action, rateLimitIdentity(req, userId), limit, window);
}

/**
 * Core limiter.
 * - `action`: human-readable action name (e.g., 'rpc')
 * - `who`: either a string key or an object { userId?, ip?, extra? }
 * - `limit`: max hits per window
 * - `window`: string like '10s' | '1m' | '5m' | '1h'
 *   Prefer using limitByRequest(...) to avoid handling raw IPs in route handlers.
 */
export async function rateLimitDetailed(
  action: string,
  who: string | { userId?: string | null; ip?: string | null; extra?: string | null },
  limit: number,
  window: string,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = parseWindow(window);
  const key = typeof who === 'string' ? who : callerKey(who);
  const mapKey = `${action}:${key}`;

  const bucket = buckets.get(mapKey) ?? { hits: [], lastWindowMs: windowMs };
  // If the policy window changed for this key, update stored window.
  if (bucket.lastWindowMs !== windowMs) bucket.lastWindowMs = windowMs;

  // Drop timestamps older than the window (hits[] is kept sorted ascending)
  const since = now - windowMs;
  let idx = 0;
  const arr = bucket.hits;
  while (idx < arr.length && arr[idx] < since) idx++;
  const pruned = idx > 0 ? arr.slice(idx) : arr;

  let allowed = false;
  if (pruned.length < limit) {
    pruned.push(now);
    allowed = true;
  }

  // Save back (or delete if empty to avoid memory growth)
  if (pruned.length === 0) {
    buckets.delete(mapKey);
  } else {
    buckets.set(mapKey, { hits: pruned, lastWindowMs: windowMs });
  }

  maybeCleanup(now);

  // Estimate next reset and remaining
  const oldest = pruned[0];
  const resetAt = oldest ? oldest + windowMs : now;

  return {
    allowed,
    remaining: Math.max(0, limit - pruned.length),
    resetAt,
    limit,
    windowMs,
    key,
    policyId: action,
  };
}

/**
 * Build standardized rate limit headers for API responses.
 *
 * Emits:
 *   - IETF draft headers:
 *       RateLimit-Policy:  "default";q=<limit>;w=<windowSec>
 *       RateLimit:         "default";r=<remaining>;t=<resetSec>
 *   - Trio:
 *       RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (seconds until reset)
 *   - Retry-After (on 429)
 *   - X-RateLimit-* mirrors (epoch seconds)
 */
export function buildRateLimitHeaders(res: RateLimitResult): Record<string, string> {
  const nowMs = Date.now();
  const nowEpoch = Math.floor(nowMs / 1000);
  const windowSec = Math.max(1, Math.ceil(res.windowMs / 1000));
  const resetSec = Math.max(0, Math.ceil((res.resetAt - nowMs) / 1000));

  const h: Record<string, string> = {};

  const label = res.policyId || 'default';
  // IETF draft headers
  h[RATE_LIMIT_IETF_HEADERS.RATE_LIMIT] = `"${label}";r=${res.remaining};t=${resetSec}`;
  h[RATE_LIMIT_IETF_HEADERS.POLICY] = `"${label}";q=${res.limit};w=${windowSec}`;

  // Trio
  h[RATE_LIMIT_TRIO_HEADERS.LIMIT] = String(res.limit);
  h[RATE_LIMIT_TRIO_HEADERS.REMAINING] = String(res.remaining);
  h[RATE_LIMIT_TRIO_HEADERS.RESET] = String(resetSec);
  if (!res.allowed) {
    h[RATE_LIMIT_TRIO_HEADERS.RETRY_AFTER] = String(resetSec);
  }

  // X- mirrors
  h[RATE_LIMIT_X_HEADERS.LIMIT] = String(res.limit);
  h[RATE_LIMIT_X_HEADERS.REMAINING] = String(res.remaining);
  h[RATE_LIMIT_X_HEADERS.RESET] = String(nowEpoch + resetSec);

  return h;
}

/**
 * Single blessed API: deterministic and testable.
 * Callers must provide a stable key (e.g., `u:<userId>` or hashed-ip identity) and a policyId.
 */
export async function rateLimit(input: { key: string; policyId: string }): Promise<RateLimitResult> {
  const policy = resolveRateLimitPolicy(input.policyId);
  return rateLimitDetailed(input.policyId, input.key, policy.limit, policy.window);
}

/**
 * Optionally limit by user OR ip in custom code paths:
 *   await limitByRequest('post:create', req, userId, 10, '1m')
 */
export async function limitByUserOrIp(
  action: string,
  ids: { userId?: string | null; ip?: string | null; extra?: string | null },
  limit: number,
  window: string,
): Promise<RateLimitResult> {
  return rateLimitDetailed(action, ids, limit, window);
}

/** Soft cap to avoid unbounded memory growth in dev/single-node envs */
const MAX_BUCKETS = 5000;

/** Opportunistic cleanup when buckets grow large */
function maybeCleanup(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [k, b] of buckets) {
    const newest = b.hits[b.hits.length - 1];
    if (!newest || now - newest > b.lastWindowMs) {
      buckets.delete(k);
    }
  }
}
