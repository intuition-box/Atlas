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

  // Communities
  communitiesIndex: "/c",
  communityNew: "/new",

  // Back-compat / nicer names (keep routes.ts as the single source of truth)
  newCommunity: "/new",
} as const;

/** `/u/:handle` */
export function userPath(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`;
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

/** `/c/:handle/settings` */
export function communitySettingsPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/settings`;
}

/** Convenience grouped helpers (string-building only). */
export const ROUTE = {
  user: userPath,
  community: communityPath,
  communityApply: communityApplyPath,
  communityDashboard: communityDashboardPath,
  communitySettings: communitySettingsPath,
} as const;