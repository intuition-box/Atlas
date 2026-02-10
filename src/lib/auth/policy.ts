import "server-only";

import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { HandleOwnerType } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { ROUTES } from "@/lib/routes";

import type { ApiError, Result } from "@/lib/api/shapes";
import { err, ok } from "@/lib/api/shapes";

async function resolveUserHandleName(userId: string): Promise<string | undefined> {
  const row = await db.handleOwner.findUnique({
    where: {
      ownerType_ownerId: {
        ownerType: HandleOwnerType.USER,
        ownerId: userId,
      },
    },
    select: { handle: { select: { name: true } } },
  });

  return row?.handle.name ?? undefined;
}

async function resolveUserOnboarded(userId: string): Promise<boolean> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { onboardedAt: true },
  });

  return Boolean(row?.onboardedAt);
}

/**
 * Server-only auth/onboarding guards.
 *
 * Two usage patterns:
 * - Route handlers / server actions: throw a structured `AuthError` at the boundary in `require*` helpers.
 * - Server Components / layouts: redirect to sign-in/onboarding (with safe returnToUrl).
 */

// Schema-first: Zod schema is the source of truth for runtime validation
export const AuthErrorSchema = z.object({
  code: z.enum(["AUTH_REQUIRED", "ONBOARDING_REQUIRED"]),
  message: z.string(),
  status: z.union([z.literal(401), z.literal(428)]),
});

export type AuthErrorCode = "AUTH_REQUIRED" | "ONBOARDING_REQUIRED";
export type AuthError = ApiError<AuthErrorCode, 401 | 428>;
export type AuthResult<T> = Result<T, AuthError>;

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

  const onboarded = await resolveUserOnboarded(userId);

  return ok({
    session,
    userId,
    handle: undefined,
    onboarded,
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
 * Allow only internal absolute paths (e.g. "/c/atlas").
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

  if (!r.value.onboarded) {
    throw err({ code: "ONBOARDING_REQUIRED", message: "Onboarding required.", status: 428 });
  }

  const handle = await resolveUserHandleName(r.value.userId);
  const o = requireOnboardedContext({ ...r.value, handle });
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

  if (!r.value.onboarded) {
    redirectWithReturn(ROUTES.onboarding, returnToUrl);
  }

  const handle = await resolveUserHandleName(r.value.userId);
  const o = requireOnboardedContext({ ...r.value, handle });
  if (!o.ok) {
    redirectWithReturn(ROUTES.onboarding, returnToUrl);
  }

  return o.value;
}
