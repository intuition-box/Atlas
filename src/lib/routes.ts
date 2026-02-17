/**
 * Central route helpers.
 *
 * Notes:
 * - Next.js route groups like `(auth)` do NOT appear in the URL.
 * - Keep these helpers dumb: string building only.
 * - Do not import DB/auth/guards here.
 */

export const ROUTES = {
  home: "/",

  // Auth
  signIn: "/signin",
  onboarding: "/onboarding",

  // Users
  usersIndex: "/u",

  // Activity
  activity: "/activity",

  // Communities
  communitiesIndex: "/c",
  communityNew: "/new",

  // Back-compat / nicer names (keep routes.ts as the single source of truth)
  newCommunity: "/new",
} as const;

/**
 * Routes that don't require authentication.
 * Used by OnboardingGuard in providers.tsx to skip redirect logic.
 */
export const PUBLIC_ROUTES = [
  ROUTES.signIn,
  "/api/",
  "/signin",
  "/signout",
  "/error",
] as const;

/**
 * Check if a pathname is a public route (no auth required).
 */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route)
  );
}

/**
 * Check if a pathname is the onboarding route.
 */
export function isOnboardingRoute(pathname: string): boolean {
  return pathname === ROUTES.onboarding || pathname.startsWith(ROUTES.onboarding);
}

/** `/u/:handle` */
export function userPath(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`;
}

/** `/u/:handle/settings` */
export function userSettingsPath(handle: string): string {
  return `/u/${encodeURIComponent(handle)}/settings`;
}

/** `/u/:handle/attestations` */
export function userAttestationsPath(handle: string): string {
  return `/u/${encodeURIComponent(handle)}/attestations`;
}

/** `/activity` */
export function activityPath(): string {
  return ROUTES.activity;
}

/** `/c` */
export function communitiesPath(): string {
  return ROUTES.communitiesIndex;
}

/** `/c/:handle` */
export function communityPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}`;
}

/** `/c/:handle/apply` */
export function communityApplyPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/apply`;
}

/** `/c/:handle/dashboard` */
export function communityDashboardPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/dashboard`;
}

/** `/c/:handle/members` */
export function communityMembersPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/members`;
}

/** `/c/:handle/applications` */
export function communityApplicationsPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/applications`;
}

/** `/c/:handle/settings` */
export function communitySettingsPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/settings`;
}

/** `/c/:handle/orbit` */
export function communityOrbitPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/orbit`;
}
