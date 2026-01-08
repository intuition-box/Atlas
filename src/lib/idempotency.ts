import "server-only";

import { NextResponse } from "next/server";
import crypto from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { ApiResponse } from "@/types/api";
import { db } from "@/lib/database";

/**
 * Idempotency utilities (DB-backed)
 * ------------------------------------------------------------
 * - Stores and replays an *enveloped* JSON response: ApiResponse<T>
 * - Adds `idempotency: HIT|MISS` (and `Idempotency-Key` if provided)
 * - Safe for concurrent requests: first caller acquires a lock; others briefly poll
 * - Detects key reuse with different payload and returns 409
 */

export type IdemOptions = {
  /** Route identifier for uniqueness; defaults to request.pathname */
  routeId?: string;
  /** TTL for stored results (ms). Default 24h. */
  ttlMs?: number;
  /** How long a concurrent caller should wait before giving up (ms). Default 1500. */
  inFlightWaitMs?: number;
  /** Poll interval while waiting (ms). Default 250. */
  pollIntervalMs?: number;
  /** If true, reject requests without an idempotency key (400). Default false. */
  requireKey?: boolean;
  /** If true, when header key is absent attempt to use body.clientId as key. Default false (avoid footguns). */
  fallbackToClientId?: boolean;
  /** Optional caller-provided scope. Use this to scope idempotency per user (recommended for authed routes). */
  userId?: string | null;
  /** If true, persist/replay handler failures (non-2xx). Default true. */
  storeFailures?: boolean;
  /** If true, always set `Cache-Control: no-store` on responses. Default true. */
  noStore?: boolean;
};

export type IdemHandlerResult<T> = {
  /** HTTP status to return (default 200) */
  status?: number;
  /** JSON-serializable payload (will be enveloped as { success: true, data }) */
  data: T;
  /** Optional extra headers to include in the response */
  headers?: HeadersInit;
};

type HttpError = Error & { status: number };

function toHttpError(err: unknown): HttpError {
  if (err instanceof Error) {
    const status = (err as Partial<{ status: unknown }>).status;
    if (typeof status === "number") return Object.assign(err, { status });
    return Object.assign(err, { status: 500 });
  }
  const e = new Error("Internal error") as HttpError;
  e.status = 500;
  return e;
}

function jsonResponse(
  payload: unknown,
  init: {
    status: number;
    headers?: HeadersInit;
    noStore: boolean;
    idempotency: "HIT" | "MISS";
    key?: string | null;
  },
): Response {
  const headers: HeadersInit = {
    ...(init.headers ?? {}),
    ...(init.noStore ? { "cache-control": "no-store" } : {}),
    idempotency: init.idempotency,
    ...(init.key ? { "Idempotency-Key": init.key } : {}),
  };

  return NextResponse.json(payload, {
    status: init.status,
    headers,
  });
}

/** Read a case-insensitive Idempotency-Key header */
export function getIdempotencyKey(req: Request): string | null {
  return req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key") || null;
}

/**
 * Single blessed helper: require an Idempotency-Key header.
 * Throws a 400 error when missing.
 */
export function requireIdempotencyKey(req: Request): string {
  const key = getIdempotencyKey(req);
  if (key) return key;

  const err = new Error("Idempotency-Key required") as HttpError;
  err.name = "IdempotencyKeyError";
  err.status = 400;
  throw err;
}

/** Best-effort base64url SHA-256 of arbitrary input (e.g., request body) */
export function sha256Base64url(input: string): string {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

/** Resolve a stable route identifier from a request */
export function routeIdFromRequest(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "unknown";
  }
}

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

function fail(status: number, message: string): ApiResponse<never> {
  return { success: false, error: { code: status, message } };
}

/**
 * Idempotent JSON wrapper.
 * - If a valid key is present, stores/replays the response.
 * - If `requireKey` is true and no key can be resolved, returns 400.
 * - Detects reuse of the same key with a different request payload (via body SHA-256) and returns 409.
 * - On handler error, records a failure envelope so later replays return the same error.
 */
export async function withIdempotencyJson<T>(
  req: Request,
  keyParam: string | null | undefined,
  options: IdemOptions,
  handler: () => Promise<IdemHandlerResult<T>>,
): Promise<Response> {
  const route = options.routeId || routeIdFromRequest(req);
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000; // 24h
  const noStore = options.noStore !== false;
  const storeFailures = options.storeFailures !== false;
  const inFlightWaitMs = options.inFlightWaitMs ?? 1500;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const fallbackToClientId = options.fallbackToClientId === true;
  const userField: string = options.userId ? `u:${options.userId}` : "global";

  // Read body once (for hash + optional clientId fallback)
  let raw = "";
  try {
    raw = await req.clone().text();
  } catch {
    // ignore
  }

  const bodyHash = raw ? sha256Base64url(raw) : null;

  // Resolve key: explicit keyParam first, then header, optional fallback to body.clientId
  let key = keyParam || getIdempotencyKey(req);
  if (!key && fallbackToClientId && raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>)["clientId"] === "string" &&
        ((parsed as Record<string, unknown>)["clientId"] as string).trim().length > 0
      ) {
        key = `client:${String((parsed as Record<string, unknown>)["clientId"])}`;
      }
    } catch {
      // ignore
    }
  }

  if (options.requireKey && !key) {
    return jsonResponse(fail(400, "Idempotency-Key required"), {
      status: 400,
      noStore,
      idempotency: "MISS",
    });
  }

  // No key → execute normally and envelope (not stored)
  if (!key) {
    try {
      const { status = 200, data, headers } = await handler();
      return jsonResponse(ok(data), {
        status,
        headers,
        noStore,
        idempotency: "MISS",
      });
    } catch (err) {
      const e = toHttpError(err);
      return jsonResponse(fail(e.status, e.message || "Internal error"), {
        status: e.status,
        noStore,
        idempotency: "MISS",
      });
    }
  }

  const nowMs = Date.now();
  const expiresAt = new Date(nowMs + ttlMs);

  // Fast path: replay if we have a fresh completed record
  const found = await db.apiIdempotency.findFirst({
    where: { key, route, userId: userField, expiresAt: { gt: new Date(nowMs) } },
    orderBy: { createdAt: "desc" },
    select: { statusCode: true, response: true, lockedAt: true, bodyHash: true },
  });

  if (found && !found.lockedAt) {
    if (found.bodyHash && bodyHash && found.bodyHash !== bodyHash) {
      return jsonResponse(fail(409, "Idempotency-Key reuse with different payload"), {
        status: 409,
        noStore,
        idempotency: "MISS",
        key,
      });
    }

    return jsonResponse(found.response ?? null, {
      status: found.statusCode,
      noStore,
      idempotency: "HIT",
      key,
    });
  }

  // Try to create a lock row (relies on @@unique([key, route, userId]))
  let gotLock = false;
  try {
    // allow key reuse after TTL
    await db.apiIdempotency.deleteMany({
      where: { key, route, userId: userField, expiresAt: { lte: new Date(nowMs) } },
    });

    await db.apiIdempotency.create({
      data: {
        key,
        route,
        userId: userField,
        bodyHash: bodyHash ?? undefined,
        statusCode: 0,
        response: undefined,
        lockedAt: new Date(),
        expiresAt,
      },
    });

    gotLock = true;
  } catch {
    // someone else is handling it
  }

  // If we didn't get the lock, poll for completion briefly
  if (!gotLock) {
    const start = Date.now();

    while (Date.now() - start < inFlightWaitMs) {
      const again = await db.apiIdempotency.findFirst({
        where: { key, route, userId: userField, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { statusCode: true, response: true, lockedAt: true, bodyHash: true },
      });

      if (again && !again.lockedAt) {
        if (again.bodyHash && bodyHash && again.bodyHash !== bodyHash) {
          return jsonResponse(fail(409, "Idempotency-Key reuse with different payload"), {
            status: 409,
            noStore,
            idempotency: "MISS",
            key,
          });
        }

        return jsonResponse(again.response ?? null, {
          status: again.statusCode,
          noStore,
          idempotency: "HIT",
          key,
        });
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return jsonResponse(fail(409, "Idempotent request in progress"), {
      status: 409,
      noStore,
      idempotency: "MISS",
      headers: { "retry-after": "1" },
      key,
    });
  }

  // We have the lock — run the handler, persist, and return
  try {
    const { status = 200, data, headers } = await handler();
    const envelope = ok(data);

    await db.apiIdempotency.updateMany({
      where: { key, route, userId: userField },
      data: {
        statusCode: status,
        response: envelope as unknown as Prisma.JsonValue,
        lockedAt: null,
      },
    });

    return jsonResponse(envelope, {
      status,
      headers,
      noStore,
      idempotency: "MISS",
      key,
    });
  } catch (err) {
    const e = toHttpError(err);
    const envelope = fail(e.status, e.message || "Internal error");

    if (storeFailures) {
      await db.apiIdempotency.updateMany({
        where: { key, route, userId: userField },
        data: {
          statusCode: e.status,
          response: envelope as unknown as Prisma.JsonValue,
          lockedAt: null,
        },
      });
    } else {
      await db.apiIdempotency.updateMany({
        where: { key, route, userId: userField },
        data: { lockedAt: null },
      });
    }

    return jsonResponse(envelope, {
      status: e.status,
      noStore,
      idempotency: "MISS",
      key,
    });
  }
}