import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ApiEnvelope, ApiError, Result } from "@/lib/api/shapes";
import { err, errEnvelope, ok } from "@/lib/api/shapes";
import { db } from "@/lib/db/client";
import { readRememberDevice } from "@/lib/security/mfa";

/**
 * Step-up authentication
 *
 * Use this before sensitive actions (disable MFA, revoke sessions, delete account, delete space, etc.).
 *
 * Policy:
 * - Allow if the user authenticated recently (authAt within `windowSec`).
 * - Otherwise allow if a valid remember-device cookie exists for the same user.
 * - Otherwise require step-up and report what methods are available.
 *
 * This module is intentionally small:
 * - It does not start a step-up flow.
 * - It only answers: "is step-up satisfied?" and "if not, what can the user do?"
 */

export type StepUpMethod = "passkey" | "totp";

export type StepUpContext = {
  userId: string;
  /** When the user last authenticated (typically session issuance). Optional; if omitted we infer from the database session record. */
  authAt?: Date | string | null;
};

export type StepUpErrorCode = "STEP_UP_REQUIRED";

export type StepUpProblem = ApiError<
  StepUpErrorCode,
  401,
  {
    windowSec: number;
    methods: StepUpMethod[];
  }
>;

export type StepUpResult<T> = Result<T, StepUpProblem>;

const DEFAULT_WINDOW_SEC = 10 * 60; // 10 minutes

// Auth.js / NextAuth session cookie names (database session strategy).
// We try a small set to avoid coupling this module to a specific branding/config.
const SESSION_COOKIE_CANDIDATES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
] as const;

function readSessionToken(req: NextRequest): string | null {
  for (const name of SESSION_COOKIE_CANDIDATES) {
    const v = req.cookies.get(name)?.value;
    if (v) return v;
  }
  return null;
}

async function sessionAuthAtFromDb(req: NextRequest): Promise<Date | null> {
  const sessionToken = readSessionToken(req);
  if (!sessionToken) return null;

  const row = await db.session.findUnique({
    where: { sessionToken },
    select: { createdAt: true },
  });

  return row?.createdAt ?? null;
}

function toEpochMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function isRecentAuth(authAt: Date | string | null | undefined, windowSec: number, nowMs: number): boolean {
  const t = toEpochMs(authAt);
  if (t == null) return false;
  return nowMs - t <= windowSec * 1000;
}

async function availableMethods(userId: string): Promise<StepUpMethod[]> {
  const [passkeys, totp] = await Promise.all([
    db.webAuthnCredential.count({ where: { userId } }),
    db.mfaTotp.findUnique({ where: { userId }, select: { enabledAt: true } }),
  ]);

  const methods: StepUpMethod[] = [];
  if (passkeys > 0) methods.push("passkey");
  if (totp?.enabledAt) methods.push("totp");
  return methods;
}

function stepUpRequiredProblem(windowSec: number, methods: StepUpMethod[]): StepUpProblem {
  return {
    code: "STEP_UP_REQUIRED",
    message: "Step-up authentication required.",
    status: 401,
    meta: { windowSec, methods },
  };
}

/**
 * Check whether step-up requirements are satisfied.
 *
 * Returns:
 * - ok(null) when satisfied
 * - err(problem) when step-up is required
 */
export async function requireStepUp(
  req: NextRequest,
  ctx: StepUpContext,
  opts?: { windowSec?: number; nowMs?: number },
): Promise<StepUpResult<null>> {
  const windowSec = opts?.windowSec ?? DEFAULT_WINDOW_SEC;
  const nowMs = opts?.nowMs ?? Date.now();

  // Prefer explicit authAt if the caller has it; otherwise infer from the database session.
  const authAt = ctx.authAt ?? (await sessionAuthAtFromDb(req));
  if (isRecentAuth(authAt, windowSec, nowMs)) {
    return ok(null);
  }

  const remembered = readRememberDevice(req);
  if (remembered && remembered.userId === ctx.userId) {
    return ok(null);
  }

  const methods = await availableMethods(ctx.userId);
  return err(stepUpRequiredProblem(windowSec, methods));
}

/**
 * Standard response helper for step-up errors.
 */
export function stepUpErrorResponse(problem: StepUpProblem): NextResponse<ApiEnvelope<never>> {
  const res = NextResponse.json(errEnvelope(problem), { status: problem.status });
  // Step-up responses should never be cached.
  res.headers.set("cache-control", "no-store");
  return res;
}
