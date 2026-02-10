/**
 * Source of truth for reserved handle names.
 *
 * Conventions:
 * - All entries are lowercase.
 * - Entries represent full handle values (not "keys").
 * - Callers should normalize user input (via `makeHandleCandidate` / `parseHandle`) before checking.
 * - Do not mutate this set at runtime.
 */
export const RESERVED_HANDLES = new Set<string>([
  // ---------------------------------------------------------------------------
  // Core / staff / authority (avoid impersonation)
  // ---------------------------------------------------------------------------
  "admin",
  "administrator",
  "root",
  "system",
  "owner",
  "team",
  "staff",
  "moderator",
  "moderators",
  "mod",
  "mods",
  "support",
  "help",
  "meta",
  "official",

  // ---------------------------------------------------------------------------
  // Common UX routes / top-level pages
  // ---------------------------------------------------------------------------
  "home",
  "welcome",
  "about",
  "contact",
  "pricing",
  "plans",
  "billing",
  "payments",
  "subscribe",
  "subscription",
  "legal",
  "privacy",
  "terms",
  "status",
  "docs",
  "blog",
  "changelog",
  "roadmap",
  "support",
  "faq",

  // Navigation / discovery
  "search",
  "explore",
  "discover",
  "feed",
  "trending",
  "popular",
  "latest",
  "new",
  "create",

  // Account / settings
  "account",
  "accounts",
  "settings",
  "dashboard",
  "notifications",
  "inbox",
  "messages",
  "chat",

  // Useful special-cases that many apps reserve
  "me",
  "you",

  // ---------------------------------------------------------------------------
  // Auth flows / identity
  // ---------------------------------------------------------------------------
  "auth",
  "login",
  "logout",
  "signin",
  "signup",
  "signout",
  "register",
  "verify",
  "reset",
  "forgot",
  "invite",
  "join",
  "apply",

  // ---------------------------------------------------------------------------
  // Route groups & resource namespaces
  // ---------------------------------------------------------------------------
  "u",
  "user",
  "users",
  "c",
  "community",
  "communities",
  "m",
  "member",
  "members",
  "membership",
  "memberships",
  "p",
  "post",
  "posts",
  "b",
  "board",
  "boards",
  "h",
  "handle",
  "handles",

  // Product nouns that commonly become top-level routes
  "attestation",
  "attestations",
  "verification",
  "verifications",
  "scoring",
  "analytics",
  "insights",
  "quests",
  "quest",
  "badges",
  "badge",
  "leaderboard",
  "leaderboards",
  "rewards",
  "reward",

  // ---------------------------------------------------------------------------
  // API / security / infra (never claimable)
  // ---------------------------------------------------------------------------
  "api",
  "apis",
  "api-endpoint",
  "api-endpoints",
  "rpc",
  "graphql",
  "webhook",
  "webhooks",
  "events",
  "eventing",
  "csrf",
  "security",
  "idempotency",
  "ratelimit",
  "rate-limit",
  "limits",
  "quota",
  "quotas",

  "db",
  "database",
  "sql",
  "cache",
  "caches",
  "metrics",
  "monitoring",
  "health",
  "healthz",

  "internal",
  "private",
  "protected",
  "admin-api",

  // Auth protocols
  "authn",
  "authz",
  "oauth",
  "oauth2",
  "openid",
  "sso",
  "saml",

  // Dev / tooling
  "dev",
  "debug",
  "logs",
  "logging",
  "migrations",
  "migration",
  "seeds",
  "seed",
  "tests",
  "test",
  "testing",
  "spec",
  "specs",
  "experiments",
  "experiment",
  "beta",
  "betas",

  // Files / assets / static endpoints
  "static",
  "public",
  "assets",
  "cdn",
  "upload",
  "uploads",
  "file",
  "files",
  "media",
  "img",
  "image",
  "images",
  "js",
  "css",

  // Common static files
  "favicon",
  "favicon.ico",
  "robots",
  "robots.txt",
  "sitemap",
  "sitemap.xml",

  // ---------------------------------------------------------------------------
  // Brand-safe
  // ---------------------------------------------------------------------------
  "orbit",
  "orbit-team",
  "atlas",
  "atlas-team",

  // ---------------------------------------------------------------------------
  // "weird" values that should never be real identities
  // ---------------------------------------------------------------------------
  "null",
  "undefined",

  // ---------------------------------------------------------------------------
  // Library names people commonly try to claim (avoid confusion)
  // ---------------------------------------------------------------------------
  "next",
  "nextjs",
  "next-js",
  "nextauth",
  "next-auth",
  "authjs",
  "auth-js",
]);

export function isReservedHandle(h: string): boolean {
  return RESERVED_HANDLES.has(h);
}
