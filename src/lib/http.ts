import "server-only";

import { NextResponse } from "next/server";

/**
 * Error codes returned by API routes.
 * Keep these stable; clients may branch on them.
 */
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_A_MEMBER"
  | "NOT_APPROVED"
  | "CONFLICT"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

/**
 * Structured error you can throw from route handlers / server actions.
 *
 * Example:
 *   throw new AppError("FORBIDDEN", "Owner only", 403)
 */
export class AppError extends Error {
  code: ApiErrorCode;
  status: number;

  constructor(code: ApiErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function ok<T extends Record<string, unknown> | undefined>(data?: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...(data ?? {}) }, init);
}

export function fail(code: ApiErrorCode, message: string, status = 400) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

function isAppError(err: unknown): err is AppError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as any).code === "string" &&
    "status" in err &&
    typeof (err as any).status === "number" &&
    "message" in err &&
    typeof (err as any).message === "string"
  );
}

/**
 * Convert thrown domain errors into consistent JSON responses.
 * Prefer throwing `AppError` in your policies/services.
 */
export function handleRouteError(err: unknown) {
  const isDev = process.env.NODE_ENV !== "production";

  if (isAppError(err)) {
    return fail(err.code, err.message, err.status);
  }

  const msg = err instanceof Error ? err.message : "Unknown error";

  // Back-compat: allow throwing plain string codes.
  if (msg === "UNAUTHENTICATED") return fail("UNAUTHENTICATED", "Please sign in.", 401);
  if (msg === "FORBIDDEN") return fail("FORBIDDEN", "You don't have access.", 403);
  if (msg === "NOT_A_MEMBER") return fail("NOT_A_MEMBER", "Not a member.", 403);
  if (msg === "NOT_APPROVED") return fail("NOT_APPROVED", "Not approved.", 403);
  if (msg === "NOT_FOUND") return fail("NOT_FOUND", "Not found.", 404);

  // Unknown errors should be 500 so we don't hide real bugs.
  return fail("INTERNAL_ERROR", isDev ? msg : "Internal error.", 500);
}