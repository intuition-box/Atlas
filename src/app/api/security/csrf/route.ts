import type { ApiResponse } from '@/types/api';
import { NextRequest, NextResponse } from 'next/server';
import { applyCsrfRouteHeaders, isSameOrigin, issueCsrf, jsonWithCsrfToken } from '@/lib/security/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const preferredRegion = 'auto';

/**
 * GET /api/security/csrf
 * Bootstrap CSRF for browser clients.
 * - Sets/refreshes the CSRF cookie
 * - Returns `{ success: true, data: { token } }` so the client can echo it in `X-CSRF-Token`
 */
export async function GET(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) {
      const res = NextResponse.json<ApiResponse<unknown>>(
        { success: false, error: { code: 403, message: 'Cross-origin request not allowed' } },
        { status: 403 },
      );
      applyCsrfRouteHeaders(res);
      return res;
    }

    // Single-source-of-truth helper: issues cookie + returns token in the JSON body.
    const res = jsonWithCsrfToken((token) => ({ token }));
    applyCsrfRouteHeaders(res);
    return res;
  } catch {
    const res = NextResponse.json<ApiResponse<unknown>>(
      { success: false, error: { code: 500, message: 'Internal server error' } },
      { status: 500 },
    );
    applyCsrfRouteHeaders(res);
    return res;
  }
}

/**
 * HEAD /api/security/csrf
 * Refresh the CSRF cookie without a body.
 */
export async function HEAD(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) {
      const res = new NextResponse(null, { status: 403 });
      applyCsrfRouteHeaders(res);
      return res;
    }

    const res = new NextResponse(null, { status: 204 });
    issueCsrf(res, { maxAgeSeconds: 60 * 60 * 24 });
    applyCsrfRouteHeaders(res);
    return res;
  } catch {
    const res = new NextResponse(null, { status: 500 });
    applyCsrfRouteHeaders(res);
    return res;
  }
}
