import type { ApiResponse } from '@/types/api';
import { NextRequest, NextResponse } from 'next/server';
import { applyCsrfRouteHeaders, isSameOrigin, issueCsrf } from '@/lib/security/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const preferredRegion = 'auto';

/**
 * GET /api/security/csrf
 * Bootstrap CSRF for browser clients.
 * - Sets the CSRF cookie
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

    const res = NextResponse.json<ApiResponse<{ token: string }>>(
      { success: true, data: { token: '' } },
      { status: 200 },
    );

    const token = issueCsrf(res, { maxAgeSeconds: 60 * 60 * 24 }); // 24h
    // Mutate payload to include the token we just issued.
    res.headers.set('content-type', 'application/json; charset=utf-8');
    // Recreate the JSON body with token (NextResponse.json body is immutable), so create a new response.
    const finalRes = NextResponse.json<ApiResponse<{ token: string }>>(
      { success: true, data: { token } },
      { status: 200 },
    );

    // Copy Set-Cookie from the response we mutated via issueCsrf into the final response.
    const setCookie = finalRes.headers.getSetCookie?.() ?? res.headers.getSetCookie?.();
    const fallback = res.headers.get('set-cookie');
    if (Array.isArray(setCookie)) {
      for (const v of setCookie) finalRes.headers.append('set-cookie', v);
    } else if (typeof fallback === 'string' && fallback) {
      finalRes.headers.append('set-cookie', fallback);
    }

    applyCsrfRouteHeaders(finalRes);
    return finalRes;
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
 * Useful for preflight-y checks; also refreshes the CSRF cookie.
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
