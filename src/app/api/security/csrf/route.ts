import "server-only";

import type { NextRequest } from "next/server";

import { errJson } from "@/lib/api/server";
import { applyCsrfRouteHeaders, isSameOrigin, jsonWithCsrfToken } from "@/lib/security/csrf";

export const runtime = "nodejs";

function forbiddenOrigin(): ReturnType<typeof errJson> {
  // Keep this generic; UI copy belongs to clients.
  return errJson({
    code: "CSRF_ORIGIN_MISMATCH",
    message: "CSRF token issuance blocked: request origin does not match this site",
    status: 403,
  });
}

// Token issuer endpoint.
// Sets the CSRF cookie and returns { csrfToken }.
export function GET(req: NextRequest) {
  const res = isSameOrigin(req) ? jsonWithCsrfToken() : forbiddenOrigin();
  return applyCsrfRouteHeaders(res);
}

// Allow POST too (some clients prefer POST for “init” calls).
export function POST(req: NextRequest) {
  const res = isSameOrigin(req) ? jsonWithCsrfToken() : forbiddenOrigin();
  return applyCsrfRouteHeaders(res);
}