/**
 * Shared formatting utilities.
 */

/** Format an ISO timestamp as a human-friendly relative time string. */
export function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";

  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: days > 365 ? "numeric" : undefined,
    });
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/** Display name for a user object — falls back to @handle or "Unknown". */
export function displayName(user: { name?: string | null; handle?: string | null }): string {
  return user.name?.trim() || (user.handle ? `@${user.handle}` : "Unknown");
}
