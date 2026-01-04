/**
 * Source of truth for reserved handle names.
 *
 * Conventions:
 * - All entries are lowercase, hyphen-separated, and represent canonical handle segments.
 * - Callers must normalize user input (e.g., via `makeHandle`) before calling `isReservedHandle`.
 * - Do not mutate this set at runtime.
 */
export const RESERVED_HANDLES = new Set<string>([
  // Core / staffy
  'core', 'admin', 'administrator', 'root', 'system', 'owner', 'moderator', 'mods', 'mod', 'support', 'help', 'meta',

  // App paths (top-level pages)
  'account', 'settings', 'dashboard', 'home', 'welcome', 'about', 'contact', 'legal', 'privacy', 'terms', 'status', 'docs', 'blog',
  'notifications', 'inbox', 'messages', 'chat', 'billing',
  'new', 'create',

  // Auth flows
  'auth', 'login', 'logout', 'signin', 'signup', 'signout', 'register', 'verify',

  // Route groups & namespaces (vanity + resources)
  'h', 'handle', 'handles',
  'u', 'user', 'users',
  'c', 'community', 'communities',
  'apply', 'join', 'invite',
  's', 'space', 'spaces',
  'b', 'board', 'boards',
  'p', 'post', 'posts',

  // API / security / webhooks (ensure these namespaces can't be claimed)
  'api', 'security', 'csrf', 'webhooks', 'events',

  // Platform / features
  'realtime', 'mentions',

  // Tech / infra words
  'static', 'public', 'assets', 'upload', 'uploads', 'images', 'img', 'dev', 'test', 'null', 'undefined',

  // Brand-safe
  'orbit', 'orbyt', 'team', 'orbyt-team', 'official',

  // Common static files / endpoints
  'favicon', 'favicon-16x16', 'favicon-32x32', 'favicon.ico',
  'robots', 'robots.txt',
  'sitemap', 'sitemap.xml',
]);

export function isReservedHandle(h: string): boolean {
  return RESERVED_HANDLES.has(h);
}
