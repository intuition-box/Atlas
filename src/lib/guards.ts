import "server-only";

import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
import { ROUTES } from "@/lib/routes";

import type { ApiError, Result } from "@/lib/api-shapes";
import { err, ok } from "@/lib/api-shapes";

/**
 * Server-only auth/onboarding guards.
 *
 * Two usage patterns:
 * - Route handlers / server actions: throw a structured `AuthProblem` at the boundary in `require*` helpers.
 * - Server Components / layouts: redirect to sign-in/onboarding (with safe returnToUrl).
 */
export type AuthErrorCode = "AUTH_REQUIRED" | "ONBOARDING_REQUIRED";

export type AuthProblem = ApiError<AuthErrorCode, 401 | 428>;
export type AuthResult<T> = Result<T, AuthProblem>;

type AuthContext = {
  session: Session;
  userId: string;
  handle?: string;
  onboarded: boolean;
};

async function checkAuth(): Promise<AuthResult<AuthContext>> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!session || !userId) {
    return err({ code: "AUTH_REQUIRED", message: "Please sign in.", status: 401 });
  }

  return ok({
    session,
    userId,
    handle: session.user.handle ?? undefined,
    onboarded: Boolean(session.user.onboarded),
  });
}

function requireOnboardedContext(
  ctx: AuthContext,
): AuthResult<{ session: AuthContext["session"]; userId: string; handle: string }> {
  if (!ctx.onboarded || !ctx.handle) {
    return err({ code: "ONBOARDING_REQUIRED", message: "Onboarding required.", status: 428 });
  }
  return ok({ session: ctx.session, userId: ctx.userId, handle: ctx.handle });
}

/**
 * Allow only internal absolute paths (e.g. "/c/orbyt").
 * Reject "//" to avoid scheme-relative redirects.
 */
export function safeReturnToUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toString().trim();
  // Reject control chars and backslashes to avoid weird parsing edge-cases.
  if (/[\u0000-\u001F\u007F]/.test(s)) return null;
  if (s.includes("\\")) return null;
  if (!s.startsWith("/")) return null;
  if (s.startsWith("//")) return null;
  return s;
}

export function redirectWithReturn(to: string, returnToUrl?: string | null): never {
  const safe = safeReturnToUrl(returnToUrl);
  if (!safe) {
    return redirect(to);
  }

  const sep = to.includes("?") ? "&" : "?";
  return redirect(`${to}${sep}returnToUrl=${encodeURIComponent(safe)}`);
}

/**
 * Require authentication. Throws when unauthenticated.
 */
export async function requireAuth(): Promise<{ session: AuthContext["session"]; userId: string }> {
  const r = await checkAuth();
  if (!r.ok) throw r.error;
  return { session: r.value.session, userId: r.value.userId };
}

/**
 * Require authentication + onboarding (handle present).
 * Throws when unauthenticated or not onboarded.
 */
export async function requireOnboarded(): Promise<{ session: AuthContext["session"]; userId: string; handle: string }> {
  const r = await checkAuth();
  if (!r.ok) throw r.error;

  const o = requireOnboardedContext(r.value);
  if (!o.ok) throw o.error;
  return o.value;
}

/**
 * Require authentication; redirect to sign-in when unauthenticated.
 */
export async function requireAuthRedirect(
  returnToUrl?: string | null,
): Promise<{ session: AuthContext["session"]; userId: string }> {
  const r = await checkAuth();
  if (!r.ok) redirectWithReturn(ROUTES.signIn, returnToUrl);
  return { session: r.value.session, userId: r.value.userId };
}

/**
 * Require authentication + onboarding; redirect unauthenticated users to sign-in and
 * non-onboarded users to onboarding.
 */
export async function requireOnboardedRedirect(
  returnToUrl?: string | null,
): Promise<{ session: AuthContext["session"]; userId: string; handle: string }> {
  const r = await checkAuth();
  if (!r.ok) redirectWithReturn(ROUTES.signIn, returnToUrl);

  const o = requireOnboardedContext(r.value);
  if (!o.ok) {
    redirectWithReturn(ROUTES.onboarding, returnToUrl);
  }

  return o.value;
}
