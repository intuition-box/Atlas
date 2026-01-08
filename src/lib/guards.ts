import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { ROUTES } from "@/lib/routes";

type SessionUser = {
  id?: string;
  handle?: string;
};

type StatusError = Error & { status: number };

function fail(status: number, message: string): never {
  const err = new Error(message) as StatusError;
  err.name = "AuthError";
  err.status = status;
  throw err;
}

export function safeReturnToUrl(input?: string | null) {
  const raw = (input ?? "").trim();
  // Prevent open redirects: only allow internal absolute paths.
  if (!raw.startsWith("/")) return null;
  // Disallow protocol-relative URLs.
  if (raw.startsWith("//")) return null;
  return raw;
}

export function redirectWithReturn(to: string, returnToUrl?: string | null) {
  const safe = safeReturnToUrl(returnToUrl);
  if (!safe) redirect(to);

  const sep = to.includes("?") ? "&" : "?";
  redirect(`${to}${sep}returnToUrl=${encodeURIComponent(safe)}`);
}

/**
 * Guard for Route Handlers / policies.
 * Throws (does not redirect) when unauthenticated.
 */
export async function requireAuth() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  const userId = user?.id;

  if (!session || !userId) fail(401, "Please sign in.");
  return { session, userId };
}

/**
 * Guard for Route Handlers / policies.
 * Throws 428 when onboarding is incomplete.
 */
export async function requireOnboarded() {
  const { session, userId } = await requireAuth();
  const user = session?.user as SessionUser | undefined;
  const handle = user?.handle;

  if (!handle) fail(428, "Onboarding required.");
  return { session, userId, handle };
}

/**
 * Guard for Layouts/Pages (redirect UX).
 * Use in Server Components. Do not use in Edge/proxy.
 */
export async function requireAuthRedirect(returnToUrl?: string) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  const userId = user?.id;

  if (!session || !userId) redirectWithReturn(ROUTES.signIn, returnToUrl);
  return { session, userId: userId! };
}

/**
 * Guard for Layouts/Pages (redirect UX).
 * Onboarding is complete once `session.user.handle` exists.
 */
export async function requireOnboardedRedirect(returnToUrl?: string) {
  const { session, userId } = await requireAuthRedirect(returnToUrl);
  const user = session?.user as SessionUser | undefined;
  const handle = user?.handle;

  if (!handle) redirectWithReturn(ROUTES.onboarding, returnToUrl);
  return { session, userId, handle: handle! };
}
