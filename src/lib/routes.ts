

import "server-only";

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
} as const;

export function userPath(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`;
}

export function communitiesPath(): string {
  return ROUTES.communitiesIndex;
}

export function communityPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}`;
}

export function communityApplyPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/apply`;
}

export function communityDashboardPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/dashboard`;
}

export function communitySettingsPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}/settings`;
}