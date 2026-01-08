# AGENTS.md — Development Playbook

> **Purpose**: Give AI Code Assistants (and humans) a precise, opinionated playbook so generated code matches our architecture, patterns, and quality bar. This file is **source-of-truth** for conventions in this app.
> **Security is the gatekeeper**: If a trade-off exists, choose the most secure option and call it out.
>
> [!IMPORTANT] Security defaults
> - Server-enforced auth/role checks (no client-only gating)
> - Validate all inputs with Zod at boundaries
> - Least-privilege policies and minimized surface area
> - No secrets in code; all via env + typed env modules (`serverEnv` / `clientEnv`)
> - S3-compatible presigned uploads (Cloudflare R2) only
> - Default API response envelope `ApiResponse<T>`
> - Set `export const runtime = 'nodejs'` when using Node-only libs (e.g., `nodemailer`, AWS SDK)
>
> [!NOTE] Stack & versions
> - Next.js **16.x** (App Router) + React **19.2**
> - Node.js **22.x (current LTS recommended)** *(Next.js 16 requires Node **20.9+**; newer majors are OK if the repo pins them)*
> - Prefer the repo’s pinned Node version (e.g. `.nvmrc`, `package.json#engines`, CI) over this doc when they disagree.
> - TypeScript **5.x** (min 5.1)
- Prisma **7.x** (default @prisma/client output in node_modules; optionally prisma.config.ts + driver adapters / Accelerate)
> - NextAuth **v5** (`next-auth@5`, `AUTH_*` env vars)
> - Tailwind CSS **4.x** (CSS-first), Zod **4.x**
> - Optional: Shadcn with Base UI primitives, Ably, Vercel KV, etc.
> **If the repo pins versions, `package.json` + lockfile win. This section is a recommended baseline for new apps.**
>
> [!WARNING] Build & Bundler
> - **Dev**: Use the repo default (`npm run dev` / `next dev`). In Next.js 16, dev mode uses Turbopack by default — don’t add bundler flags unless debugging.
> - **Debug fallback**: If you hit a weird HMR/CSS/build issue, re-run once with Webpack dev mode (e.g., `next dev --webpack`) to confirm whether it’s a Turbopack issue.
> - **CI / Production**: Ship with whatever the repo’s `package.json` scripts run (usually `next build`). Don’t add bundler flags in CI/prod unless the repo explicitly opts in.
> - **Source of truth**: `package.json` scripts + `next.config.*` always win.
> - `revalidateTag(tag, cacheLife?)` can optionally take a cache-life profile (e.g., `'max'`) in newer Next.js versions. Follow the official Next.js docs for the repo's pinned Next version.
> - In Next.js 16, the `middleware.ts` convention is deprecated in favor of `proxy.ts` (Edge proxy).
> - Prefer layout/server guard helpers for auth/onboarding redirects; use `proxy.ts` only for true edge/header/network-boundary concerns (e.g., security headers, rewrites, bot blocking).
 

<details>
  <summary><strong>Table of Contents</strong></summary>

- [1) Golden Rules](#1-golden-rules)
- [2) Tech Stack](#2-tech-stack)
- [3) Contributing Quick Start](#3-contributing-quick-start)
- [4) Repository Layout (authoritative)](#4-repository-layout-authoritative)
- [5) Feature Slice Template (end-to-end)](#5-feature-slice-template-end-to-end)
- [6) Key Integration Rules](#6-key-integration-rules)
- [7) Code Conventions](#7-code-conventions)
- [8) Code Implementation](#8-code-implementation)
- [9) Standard API Route Pattern](#9-standard-api-route-pattern)
- [10) Component Pattern (Client)](#10-component-pattern-client)
- [11) UI & Styling Conventions](#11-ui--styling-conventions)
- [12) State Management Patterns](#12-state-management-patterns)
- [13) Our Specific Integration Patterns](#13-our-specific-integration-patterns)
- [14) Auth, Roles & Policies](#14-auth-roles--policies)
- [15) Error, Logging, and Observability](#15-error-logging-and-observability)
  - [15.1) Form validation](#151-form-validation)
  - [15.2) Client-side error boundaries](#152-client-side-error-boundaries)
  - [15.3) API error responses](#153-api-error-responses)
  - [15.4) Logging API (our logger)](#154-logging-api-our-logger)
  - [15.5) Events (trackEvent)](#155-events-trackevent)
- [16) Security Essentials](#16-security-essentials)
- [17) Database & Seeds](#17-database--seeds)
- [18) Performance & Caching](#18-performance--caching)
- [19) Accessibility & i18n](#19-accessibility--i18n)
- [20) Testing Strategy](#20-testing-strategy)
- [21) Developer Ergonomics](#21-developer-ergonomics)
  - [21.1) PR Checklist (quick)](#211-pr-checklist-quick)
- [22) Using AI Assistants (this doc's audience)](#22-using-ai-assistants-this-docs-audience)
- [23) Next.js Runtime & RSC Guidelines](#23-nextjs-runtime--rsc-guidelines)
- [24) Cron Jobs & Scheduled Tasks](#24-cron-jobs--scheduled-tasks)

</details>


## 0) How to use this playbook (for AI agents)

This file is meant to be **dropped into a repo** and treated as the **single source of truth** for how code should be written.

**Agent contract**
- If instructions conflict: **Security > data integrity > user experience > performance > developer ergonomics**.
- Make changes in the **smallest possible PR-sized slice** (end-to-end, testable, shippable).
- When you create new patterns, **update this file** in the same PR so the repo stays coherent.
- If you must deviate, **call it out explicitly** in the PR description and add a follow-up task.

**Implementation Rules**  
- If requirements are clear and non-ambiguous, proceed directly to implementation.
- Only request clarification when genuinely uncertain about intent or when multiple valid approaches exist.

**Required conventions (must follow)**
- API routes follow the **resource-grouped, verb-based** convention (Section 9): only `GET` + `POST`, `GET` is only `/<resource>/list`, **no IDs in the URL**, max 3 path segments.
- Framework-required routes are explicit exceptions (NextAuth handlers, cron); see Section 9.0 **Exceptions (explicit)**.
- Every route enforces **CSRF + rate limiting**; every `POST` route also enforces **idempotency**.
- Validate inputs with **Zod at the boundary** and return the standard `ApiResponse<T>` envelope.
- Server-side auth/role checks for anything sensitive (never rely on client gating).
- Use `auth()` from `@/lib/auth` for all authentication (Section 13).
- Use IETF standard rate limit headers (`RateLimit-*`, not `X-RateLimit-*`).

**Optional conventions (good defaults)**
- Ably, Vercel KV, R2 uploads, etc. (Section 13) — adopt only if you need them.

---

## 1) Golden Rules

- **Prefer clarity over cleverness.** Small pure functions, descriptive names, minimal surface area.
- **Type-first.** Zod for data boundaries, strict TypeScript everywhere (no `any`, no implicit `any`).
- **One place of truth.** Types and validators live with the domain, reused across server/client.
- **Accessible by default.** Follow a11y and i18n rules; never regress contrast, focus, semantics.
- **Security-in-depth.** Validate inputs, check auth/role on the server, least privilege policies.
- **Incremental delivery.** Small PRs, test-covered, with migration/rollback steps when needed.

---

## 2) Tech Stack

> [!NOTE] Versions
> See version requirements in the top-level callout. The canonical source is `package.json` + lockfile.

**Core Stack:**
- Next.js (App Router) + React  
- TypeScript (strict mode)
- Prisma + PostgreSQL
- NextAuth
- Tailwind CSS
- Zod validation

**Integration Libraries:**
- Shadcn/ui with Base UI primitives
- (Optional) Ably, Vercel KV, Cloudflare R2

All version numbers are documented once at the top of this file. If versions conflict between this doc and `package.json`, the lockfile wins.

---

**New here? Suggested reading order** → **3 → 5 → 9 → 14 → 23**.

## 3) Contributing Quick Start

**Install & run**
- `npm i`
- `npm run dev`  → Next.js dev server (Turbopack)

**Quality gates (run locally and in CI)**
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`  → If missing, add the script below
- `npm run test` (if tests exist for the feature)

**Copy me → add a typecheck script to `package.json`**
```jsonc
// package.json (scripts section)
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

**Build & start**
- `npm run build`  → uses `prisma generate && next build`
- `npm run start`

**Database**
- `npm run db:migrate`
- `npm run db:seed`
- `npm run db:reset`

**Before opening a PR**
- Follow the [PR Checklist](#211-pr-checklist-quick)
- Include migration notes, rollback steps, and screenshots for UI changes

**Path alias tip (`@/*`)**

If the `@/*` alias isn't working locally, ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

**CI (runs on every PR)**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
    branches: [ main ]
permissions:
  contents: read
  pull-requests: read

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: 'npm'

      - name: Install
        run: npm ci

      - name: Prisma generate (ensure types)
        run: npx prisma generate

      - name: Format check
        run: npm run format:check

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck
```
---

## 4) Repository Layout (authoritative)

```
docs/                   # documentation
emails/                 # transactional email templates
prisma/                 # schema.prisma, seeds, migrations
src/
├── app/                # Next.js App Router
│   ├── (auth)/         # auth pages (route group exception to kebab-case)
│   ├── (marketing)/    # brand, terms, cookie policy, blog
│   ├── (membership)/   # membership and subscription
│   ├── (spaces)/       # spaces, boards, posts, comments, uploads, settings
│   ├── (users)/        # user and account settings
│   ├── api/            # route handlers: verb-based /api/<resource>/<verb> (max 3 segments after /api)
│   ├── globals.css     # root styles and Tailwind imports
│   ├── layout.tsx      # root layout
│   ├── not-found.tsx   # root 404 Not Found
│   ├── page.tsx        # root page
│   └── providers.tsx   # global multiple client-only providers
├── components/         # individual components divided by category and type
│   ├── comment/        # comment type components
│   ├── form/           # form components with validation
│   ├── layout/         # global design elements
│   ├── post/           # posts type components
│   ├── ui/             # reusable UI components
│   ├── user/           # user type components
│   └── utils/          # general utility components
├── config/             # persistent constants
├── hooks/              # custom hooks (client-safe)
├── lib/                # core server utilities (db, env, auth, policy, permissions, rate-limit, validations, etc.)
├── test/               # unit & e2e tests (Jest/Playwright)
└── types/              # shared types & zod schemas
.env                    # local env (not committed)
.env.example            # document required env vars
```

**Note on route groups:** Route groups like `(auth)` and `(marketing)` use parentheses and are exceptions to the kebab-case directory naming rule. This is a Next.js convention for organizing routes without affecting URLs.

---

## 5) Feature Slice Template (end-to-end)

When adding a new resource (e.g., `Tag`):

1. **Model**

  - Add Prisma model in `prisma/schema.prisma`. Keep field names lowerCamelCase.
  - Run `prisma migrate dev -n add-tag` and update seeds if relevant.

2. **Types & Validation**

  - Create `src/types/tag.ts` with Zod schemas: `TagCreate`, `TagUpdate`, `Tag` (DB shape).
  - Export inferred TS types from Zod. No duplicate manual interfaces.

3. **Server: Route Handlers**

  - Implement verb-based routes:
    - `src/app/api/tags/list/route.ts` (GET)
    - `src/app/api/tags/create/route.ts` (POST)
    - `src/app/api/tags/get/route.ts` (POST)
    - `src/app/api/tags/update/route.ts` (POST)
    - `src/app/api/tags/delete/route.ts` (POST)
  - Validate request bodies with Zod; return typed JSON.
  - Gate by **policy** helpers from `@/lib/policy` (no inline role checks).

4. **Client: Hooks & UI**

  - Add `useTags()` and `useCreateTag()` hooks in `src/hooks/`.
  - Build UI within appropriate route group, using shadcn/ui and accessible patterns.

5. **Tests**

  - Unit-test validators & helpers in `test/unit/*`.
  - E2E happy-path in `test/e2e/*` (Playwright).

6. **Docs & Changelog**

  - Update `docs/overview.md` if the domain model changed.
  - Update `CHANGELOG.md` with date and new features.
  - PR description: migration notes, rollback plan, screenshots.

---

## 6) Key Integration Rules

1. **Authentication**: Always use `auth()` from `@/lib/auth` in API routes and server components
2. **File Uploads**: Use S3-compatible presigned URLs (Cloudflare R2), never store files in the application
3. **Real-time Features**: Use Ably for live updates, implement proper cleanup
4. **Forms**: Always use Zod validation, implement proper error states
5. **Database**: Use Prisma with proper error handling and connection pooling
6. **Caching**: Cache expensive operations in Vercel KV with appropriate TTL
7. **Emails**: Use React Email templates with Nodemailer for sending
8. **Rate Limiting**: Use IETF standard headers (`RateLimit-*`, not `X-RateLimit-*`)
9. **CSRF Protection**: Use `getCsrfToken()` from `@/lib/security/csrf` on client, `requireCsrf()` on server

These patterns ensure consistency, maintainability, and scalability across the application. Always follow these established conventions when generating new code.

---

## 7) Code Conventions

**Planning Phase**
- 3–6 bullets: **goal**, **key files**, **data shape/validation**, **security guards**, **tests**.
- Use JSDoc for all public functions, classes, methods, and interfaces
- Make the smallest end-to-end slice (ship a vertical PR).
- Only ask questions if the requirements are genuinely ambiguous.

**Code Style**
- Use 2 space indentation
- Use single quotes for strings (except to avoid escaping)
- Use semicolons
- Eliminate unused variables
- Add space after keywords
- Add space before function declaration parentheses
- Always use strict equality (===) instead of loose equality (==)
- Space infix operators
- Add space after commas
- Keep else statements on the same line as closing curly braces
- Use curly braces for multi-line if statements
- Always handle error parameters in callbacks
- Use trailing commas in multiline object/array literals

**Naming Standards**
- Components: `PascalCase` (UserProfile, RichTextEditor)
- Type definitions and Interfaces: `PascalCase` (UserProfileProps, RichTextEditorProps, ApiResponse)
- Directories: `kebab-case` (components/auth-wizard, auth-forms, user-settings)
  - **Exception**: Next.js route groups use `(parentheses)` (e.g., `(auth)`, `(marketing)`)
- Files: `kebab-case` (user-profile.tsx, rich-text-editor.tsx, api-client.ts)
- API routes: verb-based names (upload/create/route.ts, users/get/route.ts, tags/list/route.ts)
- Database models: `PascalCase` (User, Post, UserProfile)
- Database fields: `camelCase` (firstName, createdAt, isActive)

**Variables & Constants**
- Variables: `camelCase` (userData, currentUser, isLoading)
- Constants: `SCREAMING_SNAKE_CASE` (API_BASE_URL, MAX_FILE_SIZE, DEFAULT_TIMEOUT)
- Environment variables: `SCREAMING_SNAKE_CASE` (DATABASE_URL, AUTH_SECRET)
- Configuration objects: `camelCase` (authConfig, dbConfig, emailSettings)

**Specific Naming Patterns**
- Event handlers: `camelCase` with 'handle' prefix (handleClick, handleSubmit, handleFileUpload)
- Boolean variables: `camelCase` with verbs (isLoading, hasError, canSubmit, shouldRefresh)
- Custom hooks: `camelCase` with 'use' prefix (useAuth, useForm, useAblyChannel)
- Functions: `camelCase` descriptive verbs (fetchUserData, validateInput, generatePresignedUrl)
- Methods: `camelCase` descriptive verbs (getUserById, updateUserProfile, deletePost)
- Properties: `camelCase` (user.firstName, post.createdAt, config.maxRetries)
- Async functions: `camelCase` with descriptive action (fetchUsers, createUser, sendEmail)
- Utility functions: `camelCase` with clear purpose (formatDate, sanitizeInput, generateId)

**Prefixes for Clarity**
- State setters: `set` + PascalCase (setUser, setLoading, setError)
- Getters: `get` + PascalCase (getUserData, getCurrentUser, getFormattedDate)
- Validators: `validate` + PascalCase (validateEmail, validatePassword, validateForm)
- Formatters: `format` + PascalCase (formatCurrency, formatDate, formatUserName)
- Generators: `generate` + PascalCase (generateId, generatePresignedUrl, generateHash)

**Abbreviations Allowed**
- Standard abbreviations: err (error), req (request), res (response), props (properties), ref (reference)
- Domain-specific: auth (authentication), config (configuration), temp (temporary), prev (previous)
- Time-related: min (minimum), max (maximum), curr (current)
- UI-related: btn (button), img (image), nav (navigation) - use sparingly

**File Naming Patterns**
- Pages: `kebab-case` (user-profile.tsx, settings.tsx, about-us.tsx)
- Components: `kebab-case` (user-card.tsx, navigation-menu.tsx)
- Utilities: `kebab-case` (api-client.ts, date-utils.ts)
- Hooks: `kebab-case` with use prefix (use-auth.ts, use-local-storage.ts)
- Types: `kebab-case` (user-types.ts, api-types.ts, form-types.ts)

**ApiResponse type (source of truth)**

```ts
// File: @/types/api.ts

/**
 * API error payload used inside the ApiResponse error branch.
 */
export type ApiError = {
  /** Numeric HTTP-style code for the error (e.g., 400, 401, 429, 500). */
  code: number;
  /** Human-friendly error message safe to show in the UI. */
  message: string;
  /** Optional machine-friendly details for debugging (never secrets). */
  details?: unknown;
};

/**
 * Canonical API response envelope used across server and client.
 * Always return this shape from route handlers.
 *
 * Usage:
 *  - On success: { success: true, data }
 *  - On failure: { success: false, error: { code, message, details? } }
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

/**
 * Runtime type guard to validate a parsed JSON value matches ApiResponse<T>.
 * Prefer this when consuming untyped JSON at runtime.
 */
export function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.success !== 'boolean') return false;
  if (v.success === true) {
    return 'data' in v;
  }
  if (v.success === false) {
    const err = v.error as Record<string, unknown> | undefined;
    return !!err && typeof err.message === 'string' && typeof err.code === 'number';
  }
  return false;
}
// Do not re-declare this type elsewhere. Always import from @/types/api.
```

**TypeScript Patterns**
```tsx
import { z } from 'zod';

type DataType = unknown;

interface ComponentProps {
  data: DataType;
  onAction?: (item: DataType) => void;
  className?: string;
}

const formSchema = z.object({
  field: z.string().min(1, 'Required field message'),
});
type FormData = z.infer<typeof formSchema>;
```

### 7.1) TypeScript implementation rules

- Enable **strict mode** in `tsconfig.json` and keep it on.
- Prefer **`interface`** for object shapes that may be extended; use `type` for unions/intersections.
- Use **type guards** (custom predicates) to narrow `unknown`/`any` safely.
- Apply **generics** thoughtfully for reusable utilities/components.
- Use utility types (**Partial**, **Pick**, **Omit**, **Record**, **Readonly**) to compose shapes.
- Leverage mapped types when deriving variants of existing types.
- Avoid implicit `any`; annotate public function signatures.

```json
// tsconfig.json (excerpt)
{
  "compilerOptions": { "strict": true }
}
```

**Component Patterns**
```tsx
'use client'; // Only when needed (state, events, browser APIs)
import { useState, useCallback } from 'react';

interface ComponentProps {}

export function ComponentName({}: ComponentProps) {
  const [state, setState] = useState<unknown>(null);
  const isLoading = false;

  const handleAction = useCallback(() => {
    // Implementation
  }, []);

  if (isLoading) return <LoadingSpinner />;

  return <div className='proper-tailwind-classes'>{/* Content */}</div>;
}
```

---

## 8) Code Implementation

- **No TODO-only stubs.** Ship a vertical slice or mark feature-flagged. If partial, guard dead paths.
- **Avoid inline policies.** Use `@/lib/policy` for authorization checks (server only).
- **Rate limiting & slugs.** Use `@/lib/rate-limit` and `@/lib/slug` where applicable.
- **Error handling.** Never `console.log` in server code; use our centralized logger `@/lib/logger`. Return typed error payloads.
- **Data fetching.** Prefer server components & route handlers; cache via `revalidate`/`tags`/`cache` as appropriate.
- **State.** Local UI state with React state; cross-page data via server + fetch; avoid global client stores unless necessary.
- **Accessibility.** Label controls, manage focus, support keyboard users, maintain color contrast; use semantic HTML.
- **i18n.** Never hardcode user-facing strings; use a repository-approved i18n layer. Do **not** add a new i18n dependency without documenting the rationale in the PR; `package.json` is authoritative.
- **Performance.** Avoid N+1 queries, set indexes, use `select`/`include` precisely, prefer streaming/ISR where sensible.

---

## 9) Standard API Route Pattern

### 9.0) Route convention (resource-grouped, verb-based)

We use **resource grouping** with **verb-based procedures**, but **we do NOT put "rpc" in the URL**.

**Rules**
- **Only `GET` and `POST`.**
- **`GET` is only for read-only lists:**  
  `GET /api/<resource>/list` (pagination + filters via query string).
- **Everything else is `POST`:**  
  `POST /api/<resource>/<verb>` where `<verb>` is one of: `get|create|update|delete|archive|restore|attach|detach|invite|accept|reject|run|sync|export|import` (pick the clearest verb).
- **No IDs in the URL path.** IDs go in the body (POST) or query params (GET list filters).
- **Max 3 path segments** (e.g., `/api/spaces/create`). If you need deeper nesting, you picked the wrong resource boundary.

**Exceptions (explicit)**
- `src/app/api/auth/[...nextauth]/route.ts` is a framework-required route (NextAuth handlers) and is not subject to the verb/list URL rules. Do **not** wrap it with our CSRF/idempotency guards; it follows Auth.js’ conventions.
- Cron routes under `/api/cron/<verb>` may use `GET` (scheduler/webhook style). They are an exception to the `GET /list` rule. They must enforce `CRON_SECRET` auth, rate limiting, an idempotency window, and `Cache-Control: no-store`. **Do not** use CSRF for cron (it is non-browser/machine-to-machine).

**Examples**
- ✅ `GET /api/spaces/list?cursor=...&q=...`
- ✅ `POST /api/spaces/get` `{ "id": "..." }`
- ✅ `POST /api/spaces/update` `{ "id": "...", "patch": { ... } }`
- ❌ `GET /api/spaces/get/123`
- ❌ `GET /api/spaces/123`
- ❌ `PATCH /api/spaces/123`

---

### 9.1) Mandatory security guards

Every API route must enforce **all** of these:
1) **CSRF** (enforced for unsafe methods; safe methods are allowed)  
2) **Rate limiting** (IETF headers)
3) **Idempotency** *(for all `POST` routes)*

**CSRF Implementation (single blessed helper)**

Use the canonical helpers in `@/lib/security/csrf` (source of truth). Do not re-implement CSRF elsewhere.

```ts
import { getCsrfToken, requireCsrf } from '@/lib/security/csrf';

// Client: send header
// NOTE: getCsrfToken() must be client-safe (e.g., reads the CSRF token from a cookie in the browser).
fetch('/api/…', {
  credentials: 'include',
  headers: { 'X-CSRF-Token': getCsrfToken() },
});

// Server (Route Handler): enforce
requireCsrf(req);
```

**Rate Limiting (IETF Headers)**

Bucket by user ID when available; otherwise bucket by a privacy-safe hashed client identity (e.g., hashed IP).
The `policyId` must be stable and low-cardinality (resource + verb). Never include user IDs, record IDs, or query params in `policyId`.
In route handlers, compute a stable key via `getRateLimitKey(req, session?.user?.id)` (user bucket when available; otherwise a stable client identity) and call `rateLimit({ key, policyId })`. If `allowed === false`, return `429` with IETF headers.

```ts
import { rateLimit, buildRateLimitHeaders, getRateLimitKey } from '@/lib/rate-limit';

// Rate limiting (IETF headers)
// - policyId MUST be stable + low-cardinality (resource.verb)
// - key MUST be stable (prefer user bucket, otherwise hashed-ip identity)
const rlKey = getRateLimitKey(req, session?.user?.id);
const rl = await rateLimit({ key: rlKey, policyId: 'spaces.get' });

if (!rl.allowed) {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: { code: 429, message: 'Too many requests' } },
    { status: 429, headers: { ...buildRateLimitHeaders(rl), 'Cache-Control': 'no-store' } },
  );
}
```

**Idempotency Implementation**

```ts
// @/lib/idempotency.ts (DB-backed; source of truth)

export type IdemOptions = {
  /** Stable route identifier used for scoping + debugging (e.g. `/api/spaces/create`). */
  routeId?: string;
  /** Optional caller-provided scope. Prefer per-user for authed routes. */
  userId?: string | null;

  /** How long to retain an idempotency record (ms). Default is implementation-defined. */
  ttlMs?: number;
  /** How long to wait for an in-flight request with the same key (ms). Default is implementation-defined. */
  inFlightWaitMs?: number;
  /** Poll interval while waiting on an in-flight request (ms). Default is implementation-defined. */
  pollIntervalMs?: number;

  /** If true, require a header key. Recommended for mutations. */
  requireKey?: boolean;

  /**
   * Footgun: only enable if you intentionally support it.
   * If true and header key is missing, attempt to use body.clientId as the key.
   * Default: false.
   */
  fallbackToClientId?: boolean;

  /** If true, persist/replay failures (non-2xx). Default is implementation-defined. */
  storeFailures?: boolean;
  /** If true, always set Cache-Control: no-store. Default is implementation-defined. */
  noStore?: boolean;
};

export type IdemHandlerResult<T> = {
  status?: number;
  /** Domain data; the helper wraps this into `ApiResponse<T>` automatically. */
  data: T;
  /** Optional extra headers (rare). */
  headers?: HeadersInit;
};

export declare function getIdempotencyKey(req: Request): string | null;
export declare function requireIdempotencyKey(req: Request): string;

/**
 * Execute handler with DB-backed idempotency.
 * - Replays the prior response for the same (routeId, user scope, key).
 * - Enforces payload hash mismatch as 409.
 * - Concurrency-safe via DB lock + short poll.
 * - Header-only by default (no body fallback) unless `fallbackToClientId: true`.
 *
 * IMPORTANT: The handler returns `{ data }` (domain data) and throws for errors.
 * This helper is responsible for producing the `ApiResponse<T>` envelope.
 */
export declare function withIdempotencyJson<T>(
  req: Request,
  keyParam: string | null | undefined,
  options: IdemOptions,
  handler: () => Promise<IdemHandlerResult<T>>,
): Promise<Response>;
```

**What to cache/replay:**
- Replay the first response recorded for a given (user scope, route, Idempotency-Key).
- If the same key is reused with a different request body hash, return 409 (never execute twice).
- Always scope idempotency by userId when authenticated (never global unless explicitly intended).

**Note:** `withIdempotencyJson()` returns a standard `Response` (not `NextResponse`). It already returns the JSON `ApiResponse<T>` envelope; callers should only wrap the `Response` to attach extra headers (e.g., RateLimit-*) or override Cache-Control.

**Key scoping:**
Idempotency scope is determined by the helper options (prefer `userId`), not by manually concatenating the header value into a composite key.
_(Imports omitted for brevity.)_

```ts
import { requireIdempotencyKey, withIdempotencyJson } from '@/lib/idempotency';

// Prefer scoping idempotency per-user for authenticated routes.
const idempotencyKey = requireIdempotencyKey(req);

return await withIdempotencyJson(
  req,
  idempotencyKey,
  { routeId: '/api/<resource>/<verb>', userId: session.user.id, requireKey: true },
  async () => {
    // ...do work...
    return { status: 200, data: { ok: true } };
  },
);
```

**Retention:**
- DB rows should be retained for a finite window (e.g., 24h–7d) and cleaned up by a scheduled job.
- Retention policy is implementation-defined; do not rely on idempotency rows as permanent storage.

---

### 9.2) Standard response envelope

All routes return:

```ts
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: number; message: string; details?: unknown } };
```

- Never leak internal stack traces to clients.
- Prefer stable `error.code` values (e.g., `400`, `401`, `403`, `404`, `409`, `429`, `500`).
- Log server-side with a request correlation ID.

---

### 9.3) Route template

**File:** `src/app/api/<resource>/<action>/route.ts`

```ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ApiResponse } from '@/types/api';
import { requireCsrf } from '@/lib/security/csrf';
import { rateLimit, buildRateLimitHeaders, getRateLimitKey, type RateLimitResult } from '@/lib/rate-limit';
import { requireIdempotencyKey, withIdempotencyJson } from '@/lib/idempotency';
import { auth } from '@/lib/auth';
import { db } from '@/lib/database';

const Input = z.object({
  // for POST /get, /update, /delete etc
  id: z.string().min(1),
});

export async function POST(req: Request) {
  let rl: RateLimitResult | undefined;

  const guardError = (
    err: unknown,
  ): { status: number; payload: ApiResponse<never>; headers?: Record<string, string> } => {
    const headers = rl ? buildRateLimitHeaders(rl) : undefined;

    const e = err as any;
    const rawStatus = typeof e?.status === 'number' ? e.status : undefined;
    const status = rawStatus && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;

    const rawMessage =
      err instanceof Error
        ? err.message
        : typeof e?.message === 'string'
          ? e.message
          : 'Request rejected';

    const isCsrfError = err instanceof Error && (err.name === 'CsrfError' || rawMessage.includes('CSRF'));
    if (isCsrfError) {
      return {
        status: 403,
        payload: { success: false, error: { code: 403, message: 'CSRF validation failed' } },
        headers,
      };
    }

    const isIdempotencyKeyError = err instanceof Error && rawMessage.includes('Idempotency-Key');
    if (isIdempotencyKeyError) {
      return {
        status: 400,
        payload: { success: false, error: { code: 400, message: 'Idempotency-Key header required' } },
        headers,
      };
    }

    const message = status >= 500 ? 'Internal server error' : rawMessage;

    return {
      status,
      payload: { success: false, error: { code: status, message } },
      headers,
    };
  };

  try {
    // 1) Mandatory guards (enforced even when unauthenticated)
    requireCsrf(req);

    // 2) Authn/authz
    const session = await auth();

    // 3) Rate limit (bucket by user when available; otherwise privacy-safe hashed identity)
    const rlKey = getRateLimitKey(req, session?.user?.id);
    rl = await rateLimit({ key: rlKey, policyId: '<resource>.<verb>' }); // REQUIRED: replace placeholder (e.g., 'spaces.get')
    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: { code: 429, message: 'Too many requests' } },
        { status: 429, headers: { ...buildRateLimitHeaders(rl), 'Cache-Control': 'no-store' } },
      );
    }

    if (!session?.user?.id) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: { code: 401, message: 'Sign in required.' } },
        { status: 401, headers: { ...buildRateLimitHeaders(rl), 'Cache-Control': 'no-store' } },
      );
    }

    const idempotencyKey = requireIdempotencyKey(req);

    // 4) Handle with DB-backed idempotency (parse body inside so clone() works)
    const res = await withIdempotencyJson(
      req,
      idempotencyKey,
      { routeId: '/api/<resource>/<verb>', userId: session.user.id, requireKey: true },
      async () => {
        const json = await req.json();
        const parsed = Input.safeParse(json);
        if (!parsed.success) {
          const err: any = new Error('Invalid request body');
          err.status = 400;
          throw err;
        }

        const space = await db.space.findUnique({ where: { id: parsed.data.id } });
        if (!space) {
          const err: any = new Error('Not found');
          err.status = 404;
          throw err;
        }

        return { status: 200, data: space };
      },
    );

    // Attach RateLimit headers for both HIT and MISS responses.
    const headers = new Headers(res.headers);
    if (rl) {
      for (const [k, v] of Object.entries(buildRateLimitHeaders(rl))) headers.set(k, v);
    }
    headers.set('Cache-Control', 'no-store');

    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    const mapped = guardError(err);
    // NOTE: Log unexpected errors server-side; never leak internals to clients.
    return NextResponse.json<ApiResponse<never>>(mapped.payload, {
      status: mapped.status,
      headers: mapped.headers ? { ...mapped.headers, 'Cache-Control': 'no-store' } : { 'Cache-Control': 'no-store' },
    });
  }
}
```

---

### 9.4) Client fetch rules (must)

- Always send:
  - `credentials: 'include'`
- `X-CSRF-Token` header (use `getCsrfToken()` from `@/lib/security/csrf`)
  - `Idempotency-Key` header for `POST` (generate a UUID per user action)
- If you target older browsers/environments, use a UUID library fallback instead of `crypto.randomUUID()`.
- Never build URLs with IDs for API routes.
- Prefer server actions or server-side data access for internal calls; use HTTP only when you truly need the boundary.

---

### 9.5) Route Checklist (verify before merging)

- [ ] Path follows `/api/<resource>/<action>` and action is **`list` (GET)** or a **verb (POST)**
- [ ] No IDs in the URL
- [ ] `requireCsrf()` called for unsafe methods (helper is a no-op for safe methods)
- [ ] Rate limit enforced (429 uses IETF headers: `RateLimit-*`, not `X-RateLimit-*`)
- [ ] Rate limit `policyId` is set to a stable value (not the `<resource>.<verb>` placeholder)
- [ ] Idempotency enforced for `POST` (DB-backed via withIdempotencyJson; mismatch → 409)
- [ ] Zod validation at the boundary
- [ ] `ApiResponse<T>` envelope used
- [ ] Auth uses `auth()` from `@/lib/auth`
- [ ] Logs include a correlation/request ID and redact secrets


## 10) Component Pattern (Client)

```ts
'use client';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCsrfToken } from '@/lib/security/csrf';

export default function TagCreateForm({ onCreated }: { onCreated?: () => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch('/api/tags/create', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to create tag');
      onCreated?.();
      setName('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); submit(); }}
      className='space-y-3'
      aria-busy={loading}
    >
      <div className='space-y-1'>
        <Label htmlFor='name'>Name</Label>
        <Input id='name' value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <Button disabled={loading} type='submit' aria-disabled={loading}>{loading ? 'Saving…' : 'Create'}</Button>
    </form>
  );
}
```

**Component rules**
- Server components by default; switch to client only when needed (`use client`).
- Keep components small and composition-friendly. Avoid prop drilling—prefer context or colocated state.
- No untyped `any` props. Export prop types.
- Use **stable keys** in lists; avoid using the array index as a key.
- Always **clean up side effects** in `useEffect` (abort fetches, remove event listeners, clear timers).

### 10.1) Next.js built-ins (Image, Link, Script, metadata)
```ts
// Image
import Image from 'next/image';
<Image src={avatarUrl} alt={name} width={64} height={64} sizes='(max-width: 768px) 48px, 64px' priority />

// Link
import Link from 'next/link';
<Link href={`/spaces/${id}`}>Open space</Link>

// Script
import Script from 'next/script';
<Script src='https://example.com/sdk.js' strategy='afterInteractive' />

// Metadata (app/page.tsx)
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Spaces' };
```

### 10.2) Segment-level loading UI
```ts
// app/(spaces)/loading.tsx
export default function Loading() {
  return <div role='status' aria-busy='true' className='p-4'>Loading…</div>;
}
```

---

## 11) UI & Styling Conventions

- Design with **mobile-first**, responsive principles; test common breakpoints.
- Implement **dark mode** using CSS variables or Tailwind's `dark` variant.
- Maintain **consistent spacing** via Tailwind's scale; avoid ad-hoc values.
- Define **CSS variables** for theme colors/spacing; prefer tokens over hard-coded values.
- Prefer **shadcn/ui** components with **Radix primitives** for a11y and consistency.
- Use **`focus-visible`** utilities for accessible focus; never remove outlines without an alternative.
- Prefer **`motion-safe:`** variants for animations; reduce motion when `prefers-reduced-motion`.
- Use the **`prose`** class for rich text content. Limit max width for readability.
- Avoid arbitrary colors; map design choices to variables.

**Tailwind usage**
```css
/* globals.css */
@import "tailwindcss";
/* Enable the Typography plugin */
@plugin "@tailwindcss/typography";
```

**Component styling patterns**
- Always expose a `className` prop for customization.
- Structure classes from layout → spacing → color → state → modifiers.
- Keep responsive classes mobile-first; escalate with `sm:`, `md:`, `lg:`.
- Use Radix `data-[state]` attributes for states (e.g., `data-[state=open]:opacity-100`).
- Consolidate variant styles with a utility (e.g., `cva`) when components have many permutations.

---

## 12) State Management Patterns

**12.1 Local UI state**
- Use `useState` for simple, colocated component state.
- Use `useReducer` for complex state or when multiple fields change together.
- Extract reusable logic into **custom hooks**; keep effects tidy and cleaned up.
- Initialize state explicitly; avoid implicit `any`.
- For optimistic UI, `useOptimistic` is acceptable for simple flows.

**12.2 Server state vs client state**
- Prefer **Server Components** and server fetching; render data on the server and stream to the client.
- Avoid duplicating **server state** in client stores. Derive UI state from server responses instead.
- Use tag-based caching (`next: { tags: [...] }`) for server fetches and `revalidateTag()` on mutations.

**12.3 Caching with Vercel KV (when appropriate)**
- KV is great for **computed** or **expensive** reads (counts, aggregates, public config, feature flags) and **rate limits**.
- Do **not** use KV as a source of truth for relational data; Prisma/Postgres remains authoritative.
- TTL everything; only store JSON-serializable data; avoid sensitive PII.

```ts
// @/lib/cache/user.ts
import { kv } from '@vercel/kv';

const CACHE_TTL_SECONDS = 300 as const; // 5 minutes
const userKey = (id: string) => `users:${id}`;

export async function getUserCached(id: string) {
  const cached = await kv.get<unknown>(userKey(id));
  if (cached) return cached;
  const data = await fetchUserFromDb(id);
  await kv.set(userKey(id), data, { ex: CACHE_TTL_SECONDS });
  return data;
}

export async function invalidateUserCache(id: string) {
  await kv.del(userKey(id));
}
```

**Invalidation pattern**
- After mutating a user, call both `revalidateTag(spaceTag(spaceId), 'max')` (if used) **and** `invalidateUserCache(id)`.

**12.4 Global client state (rare)**
- Default stance: **avoid** app-wide client stores.
- If truly needed (offline UX, complex DnD across routes, collaborative cursors), prefer **Context + `useReducer`** with small, typed slices.
- Adding a new state library requires a short rationale in the PR and an update to this doc if it becomes a standard.

---

## 13) Our Specific Integration Patterns

**Database + Auth Stack**

```ts
// @/lib/auth.ts
// NOTE: PrismaAdapter uses Prisma and must run on Node.js runtime (not Edge)
import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { db } from '@/lib/database';

export const { auth, handlers } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: 'jwt' },
  callbacks: {
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, id: token.sub },
    }),
  },
});
```

**App Router wiring (required)**

Create `src/app/api/auth/[...nextauth]/route.ts` so assistants don't invent a different wiring. This route is a framework exception to the verb-based API convention.

```ts
// src/app/api/auth/[...nextauth]/route.ts
export const runtime = 'nodejs';

import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
```

**In Server Components and API routes:**
- Use `const session = await auth()` and handle the unauthenticated case explicitly.
- Optional: wrap route handlers with `auth(...)` if you want `req.auth` available.

**File Upload Pattern (Cloudflare R2 + Presigned URLs)**
```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import type { ApiResponse } from '@/types/api';

const presignSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 401, message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const body = presignSchema.parse(await request.json());
  const key = `${session.user.id}/${Date.now()}-${body.fileName}`;
  const presignedUrl = await generateR2PresignedUrl(key, body.contentType);

  return NextResponse.json<ApiResponse<{ presignedUrl: string; key: string }>>({
    success: true,
    data: { presignedUrl, key },
  });
}
```

**Upload policy (must)**
- Validate extension/MIME on both client (UX) and server (security). The server is authoritative.
- Restrict MIME types and max file size on the server.
- Prefix keys with the user/space scope: `${userId}/...` to avoid collisions.
- Short **presigned URL TTL** (60–300s); validate metadata before persisting.

**Real-time Features Pattern**  
_Example shown for `ably@^2.x` hooks; adjust destructuring if your hook version differs._
```ts
import { useChannel, usePresence } from 'ably/react';

export function useAblyChannel(channelName: string, userId: string) {
  const { channel } = useChannel(channelName, (message) => {
    // Handle messages
  });
  const { presenceData } = usePresence(channelName, {
    userId,
    status: 'online',
  });
  return { channel, presenceData };
}
```

**Real-time Guidelines**
- Include `eventId` + `clientId` for idempotency and echo suppression.
- Scope capabilities to a single **space** channel.
- Validate board/space + policy on the **server** before broadcasting.
- Never expose API keys in the client.
- Mint Ably tokens server-side with scoped capabilities and short TTL.

**Rich Text Editor Pattern (TipTap)**
```ts
'use client';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';

const editorExtensions = [
  StarterKit,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { class: 'text-blue-600 underline' },
  }),
  Placeholder.configure({ placeholder: 'Start typing...' }),
];
```

**Email System Pattern (React Email + Nodemailer)**
```ts
export const runtime = 'nodejs';
import { render } from '@react-email/render';
import { EmailTemplate } from '@/emails/template';
import { transporter } from '@/lib/email';
import { serverEnv } from '@/lib/env-server';

export async function sendEmail(to: string, data: EmailData) {
  const html = render(EmailTemplate(data));
  await transporter.sendMail({
    from: serverEnv.EMAIL_FROM,
    to,
    subject: data.subject,
    html,
  });
}
```

**Drag & Drop Pattern (dnd-kit)**
```ts
import { useSensors, useSensor, PointerSensor, KeyboardSensor } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);
```

**Environment & Configuration**
- **Server-only** env in `@/lib/env-server`. **Client** env in `@/lib/env-client` (must start with `NEXT_PUBLIC_`).
- Auth.js env naming: `AUTH_*` (not `NEXTAUTH_*`).

_Server env (required)_: `DATABASE_URL`, `AUTH_SECRET`, `ABLY_API_KEY`, Email (`EMAIL_SERVER_*`, `EMAIL_FROM`), R2 (`R2_*`), `NODE_ENV`  
_Server env (optional)_: `AUTH_URL` (prod), `R2_PUBLIC_BASE_URL`, OAuth (`GOOGLE_*`, `GITHUB_*`, …), Logging (`LOG_LEVEL`)  
_Client env_: `NEXT_PUBLIC_DEBUG`, `NEXT_PUBLIC_LOG_LEVEL`

```ts
// Server usage
import { serverEnv } from '@/lib/env-server';
const from = serverEnv.EMAIL_FROM;

// Client usage
import { clientEnv, clientLogLevel, debugEnabled } from '@/lib/env-client';
if (debugEnabled) { /* extra diagnostics */ }
console.debug('[log-level]', clientLogLevel, clientEnv);
```

---

## 14) Auth, Roles & Policies

- **All server mutations** must use `auth()` from `@/lib/auth` and handle the unauthenticated case explicitly.
- **All authorization checks** must call helpers in `@/lib/policy` (e.g., `requireRole('editor')`).
- **Never** check roles on the client to gate server operations.
- DB rows should be scoped to the user's space where applicable.
- When adding a policy, add unit tests and note in `CHANGELOG.md`.

---

## 15) Error, Logging, and Observability

- Centralize logging (server) with request correlation IDs.
- Use structured logs; redact PII; never log secrets or tokens.
- Map exceptions to typed error payloads; prefer 4xx for user errors, 5xx for infra.
- Use `@/lib/logger` to emit JSON logs and propagate `x-request-id`.

### 15.1) Form validation
```ts
import { z } from 'zod';

export const userSchema = z.object({
  email: z.string().email('Enter a valid email'),
  name: z.string().min(1, 'Name is required'),
});
export type UserFormData = z.infer<typeof userSchema>;
```

```ts
// app/api/users/create/route.ts (snippet)
import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';
import { userSchema } from '@/types/user';

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = userSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 400, message: 'Invalid request body' } },
      { status: 400 },
    );
  }
  // … proceed with parsed.data
}
```

### 15.2) Client-side error boundaries
```ts
// app/(spaces)/error.tsx
'use client';
import { useEffect } from 'react';
import { logger } from '@/lib/logger';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logger.error(error, 'segment_error');
  }, [error]);

  return (
    <div role='alert' className='prose max-w-prose'>
      <h2>Something went wrong</h2>
      <p>Please try again. If the problem persists, contact support.</p>
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}
```

### 15.3) API error responses
```ts
// File: @/lib/api.ts
import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';

export function apiError<T>(status: number, code: number, message: string, details?: unknown) {
  return NextResponse.json<ApiResponse<T>>(
    {
      success: false,
      error: details === undefined ? { code, message } : { code, message, details },
    },
    { status },
  );
}

// Usage (from a route handler)
// import { apiError } from '@/lib/api';
return apiError<never>(403, 403, 'You do not have access to this resource.');
```

### 15.4) Logging API (our logger)

**Basic usage**
```ts
import { logger } from '@/lib/logger';
logger.info('user signed in', { feature: 'auth', userId });
logger.error(err, 'failed to update profile');
```

**Canonical usage & signatures**

- Prefer these shapes:
  - Non-error levels:\
    `logger.info('message', { context })`
  - Error/fatal levels (with an Error):\
    `logger.error(error, 'message')` **or** `logger.error(error, { context })`
- Also supported (but use sparingly for errors without an Error object):\
  `logger.error('message', { context })`
- **Not supported:** `(message, error)` – do not pass the `Error` as the second argument.
- Only two arguments are accepted. If you need both a custom message **and** context with an error, prefer the message form:\
  `logger.error(error, 'short-context-message')`\
  and put additional details in the error object (e.g., `cause`) or follow up with an `info` log if you truly need rich context.

**Consistency rule**

- Use `'message', { context }` for `trace/debug/info/warn`.
- Use `(error, 'message')` (or `(error, { context })`) for `error/fatal`.

**Per-request logging**
```ts
import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';
import { apiError } from '@/lib/api';
import { requestLogger } from '@/lib/logger';

export async function POST(req: Request) {
  const log = requestLogger(req, { route: '/api/tags' });
  try {
    log.info('create start');
    // ...
    log.info('create success');
    return NextResponse.json<ApiResponse<Record<string, never>>>({ success: true, data: {} });
  } catch (e) {
    log.error(e as Error, 'create failed');
    return apiError<never>(500, 500, 'Internal server error');
  }
}
```

**Wrap a handler to auto-log and set `x-request-id`**
```ts
import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';
import { withRequestLogging } from '@/lib/logger';

export const GET = withRequestLogging(async (req: Request) => {
  // your logic here; request start/complete/error are logged automatically
  return NextResponse.json<ApiResponse<{ ok: true }>>({ success: true, data: { ok: true } });
});
```

**Browser transport (optional)**
```ts
// app/api/logs/ingest/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';
import { requireCsrf } from '@/lib/security/csrf';
import { rateLimit, buildRateLimitHeaders, getRateLimitKey } from '@/lib/rate-limit';
import { requireIdempotencyKey, withIdempotencyJson } from '@/lib/idempotency';
import type { LogRecord } from '@/lib/logger';

export async function POST(req: Request) {
  requireCsrf(req);

  // userId optional; pass when available
  const rl = await rateLimit({ key: getRateLimitKey(req), policyId: 'logs.ingest' });
  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 429, message: 'Too many requests' } },
      { status: 429, headers: { ...buildRateLimitHeaders(rl), 'Cache-Control': 'no-store' } },
    );
  }

  const idempotencyKey = requireIdempotencyKey(req);

  const res = await withIdempotencyJson(
    req,
    idempotencyKey,
    { routeId: '/api/logs/ingest', userId: null },
    async () => {
      const batch = (await req.json()) as LogRecord[];
      return { status: 200, data: {} };
    },
  );

  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(buildRateLimitHeaders(rl))) headers.set(k, v);
  headers.set('Cache-Control', 'no-store');

  return new Response(res.body, { status: res.status, headers });
}
```

**Environment knobs**
- Server: `LOG_LEVEL` (e.g., `info`, `debug`)
- Client: `NEXT_PUBLIC_LOG_LEVEL`

```ts
import { clientLogLevel } from '@/lib/env-client';
// Use clientLogLevel to configure browser transports or conditional logging
```

**Flush in tests**
```ts
import { logger } from '@/lib/logger';
await logger.flush();
```

### 15.5) Events (trackEvent)

**PII guard:** Never include raw email, token, code, or clipboard contents in properties. Prefer counts and enums only.

> **Single API**: Always emit events via `trackEvent({ name, properties })`. Do **not** import `@vercel/analytics` directly in components.
>
> What `trackEvent` does for you:
> - **Validate**: Zod-enforced `name` (enum) and primitive-only `properties`.
> - **Redact**: Removes likely secrets/PII by key (`password`, `token`, `totp`, `backup`, `code`, `mfa`) and by value (JWT/AWS-key/6-digit TOTP/long token-ish strings).
> - **Server log**: Structured log via `@/lib/logger` (no PII).
> - **Ingest**: `POST /api/events/ingest` with `Cache-Control: no-store`, protected by **CSRF + rate limiting (IETF headers) + idempotency**.
> - **Analytics**: Emits one Vercel Analytics hit **on the client** (dynamic import). No need to wire analytics yourself.
>
> **Current event names** (source of truth: `@/lib/events`):
> `copy_handle`, `copy_mfa_backup_codes`, `log_message`.
> 
> **Adding a new event**: open a small PR adding it to the enum in `@/lib/events`, include rationale in the description and a line in `CHANGELOG.md`. Keep names short, lowercase, snake_case.

**Usage (client or server)**
```ts
import { trackEvent } from '@/lib/events';

// Client example: copying a handle (never send the value; send metadata only)
await trackEvent({
  name: 'copy_handle',
  properties: { length: value.length, src: 'profile_card' },
});

// Server example: free-form message (redacted on risky keys/values)
await trackEvent({
  name: 'log_message',
  properties: { message: 'user-upgraded', plan: 'pro' },
});
```

**Privacy DO / DON'T**
- ✅ Send **minimal metadata** (e.g., lengths, booleans, known enums).
- ✅ Prefer `length`, `count`, `source`, `feature` to describe context.
- ❌ Don't send raw clipboard contents, tokens, emails, or IDs unless explicitly approved.

**Ingestion route**
- Implemented at `app/api/events/ingest/route.ts`; **Node.js runtime**, Zod-validated, rate-limited (IETF headers), and `no-store` responses.
- Do **not** log IP/PII in the route; the helper already logs a privacy-safe record.

---

## 16) Security Essentials

- Validate all inputs with Zod on server.
- Use parameterized queries via Prisma; add indices/unique constraints.
- Enforce CSRF-safe patterns (Route Handlers + same-site cookies).
- Set security headers in the root layout and/or `proxy.ts` when needed.
- Sanitize any HTML; never trust user content.
- No long-lived secrets in CI; prefer short-lived tokens where supported.
- Rotate credentials quarterly or upon offboarding.
- Rate-limit log ingestion routes (use IETF headers: `RateLimit-*`, `Retry-After`).

**Minimal security headers / CSP (examples)**

_16.1) DEV-lean (permissive)_
```ts
// proxy.ts
import { NextResponse } from 'next/server';

export default function proxy() {
  const res = NextResponse.next();
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
  ].join('; '));
  return res;
}
```

_16.2) PROD-lean (nonce-based)_
```ts
// proxy.ts
import { NextResponse } from 'next/server';

+export default function proxy() {
  const res = NextResponse.next();
  const nonce = crypto.randomUUID();
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
  ].join('; '));
  // e.g., expose the nonce via a header your layout reads with headers()
  res.headers.set('x-nonce', nonce);
  return res;
}
```

> Start permissive in dev; move to nonce-based in prod. Tune CSP for analytics/fonts; prefer nonces over `'unsafe-inline'`.

---

## 17) Database & Seeds

### 17.0) Prisma baseline (important)

Prisma ORM has changed a few defaults (and they matter for **Prisma 7+**):
- Prefer the default Prisma Client output (`@prisma/client` in node_modules). Do not configure a custom generator output unless you have a strong monorepo reason.
- Use the file **`prisma.config.ts`** as the single source of truth for project config, keep the datasource URL there and do **not** duplicate it in `schema.prisma`.
- In Next.js, keep Prisma usage on the **Node.js runtime** and use either a **driver adapter** (e.g. `@prisma/adapter-pg`) or Accelerate (HTTP driver) — follow what the repo already uses.

Minimum, recommended setup for Postgres (direct connection):

**`prisma/schema.prisma` (generator + datasource)**
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  // NOTE: this playbook configures the datasource URL via prisma.config.ts
}
```

**`prisma.config.ts` (project config + datasource URL)**
```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

**`src/lib/database.ts` (driver adapter + singleton)**
```ts
import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { serverEnv } from '@/lib/env-server';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: serverEnv.DATABASE_URL }),
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

> If you use MySQL/SQLite/etc, swap `@prisma/adapter-pg` for the matching adapter package.

---

**Policy & PR gating**
- Any change to `prisma/schema.prisma` **must** ship with a migration in the same PR.
- Fail PRs that modify `prisma/schema.prisma` without a migration and `.env.example` update.
- Update `prisma/seed.ts` whenever demo data should reflect the schema change.

**Naming**
- Migration names: `add-<model>`, `rename-<field>`, `drop-<table>`, `add-index-<table>-<field>`.
- Use explicit indices and unique constraints as needed.

**Seeding principles**
- Seeds must be **idempotent**. Prefer `upsert` and guard with existence checks.
- Wrap multi-step seed ops in `prisma.$transaction()`.
- Separate seeds by env:
  - **dev**: rich demo data
  - **demo**: anonymized, presentation-friendly
  - **test**: minimal, deterministic fixtures
- Drive mode via `SEED_MODE=dev|demo|test`.

**Seed skeleton**
```ts
// prisma/seed.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const mode = (process.env.SEED_MODE ?? 'dev') as 'dev' | 'demo' | 'test';

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: { email: 'admin@example.com', name: 'Admin' },
    });
    // more upserts…
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
```

**Scripts**
- `npm run db:generate` – regenerate Prisma client
- `npm run db:migrate` – create/apply a dev migration
- `npm run db:seed` – run `tsx prisma/seed.ts`
- `npm run db:reset` – reset database and re-apply migrations/seeds

### 17.1) Neon on Vercel (Prisma)

- **Runtime:** Keep Prisma usage on the **Node.js** runtime (not Edge). Prisma's default query engine is a native Node binding incompatible with Edge/Workers.  
  _If you adopt **Prisma Accelerate** (HTTP driver), you can revisit Edge, but update this doc and tests accordingly._
- **Connections:** Use Neon's **pooled** connection string for serverless environments to avoid connection storms. Prefer short-lived connections and avoid long transactions.
- **TLS:** Neon requires TLS; ensure your `DATABASE_URL` includes the required SSL parameters (Neon defaults are fine).
- **Migrations:** Run `prisma migrate` in Node.js contexts only (local dev, CI job, or a Node serverless function), not Edge.
- **NextAuth:** When using `@auth/prisma-adapter`, ensure all handlers that touch Prisma run on Node.js runtime.

**Rollback & recovery**
- Prefer forward-only migrations; if a hotfix is needed, write a follow-up migration that undoes the change.
- Consider a lightweight backup step before applying production migrations.
- Document breaking changes and rollback steps in PR + `CHANGELOG.md`.

---

## 18) Performance & Caching

- Use Next cache with `revalidate`/`tags`. Mark non-cacheable routes explicitly.
- Avoid synchronous waterfalls; parallelize independent awaits.
- Use `select` to return only necessary fields.
- Use `<Image />` correctly (`sizes`, `priority`).
- Use React.memo for expensive components and `useCallback`/`useMemo` to avoid unnecessary re-renders.
- Prefer dynamic imports for code splitting of heavy client bundles.
- Avoid inline function definitions in long lists.
- Use Suspense in Server Components to stream expensive sections.
- Prefer revalidateTag + tag-based caching to invalidate precisely after mutations.

```ts
// Prefer caching the data-layer function, not an HTTP self-fetch.
// Next.js supports Cache Components; this is a compatible, explicit option.
import { unstable_cache, revalidateTag } from 'next/cache';
import { db } from '@/lib/database';

export const spaceTag = (id: string) => `space:${id}`;

export async function getSpaceCached(id: string) {
  return unstable_cache(
    async () => db.space.findUnique({ where: { id } }),
    ['space', id],
    { tags: [spaceTag(id)] },
  )();
}

export function invalidateSpace(id: string) {
  revalidateTag(spaceTag(id), 'max');
}
```

> Tip: In Server Components, prefer calling your data layer directly (e.g., `db.space.findUnique`) instead of self-fetching an API route, unless you specifically need the HTTP boundary.

---

## 19) Accessibility & i18n

- Use semantic HTML (landmarks, headings), keyboard focus management, skip links.
- No text-only indicators; ensure color contrast.
- Strings via i18n layer; support RTL and pluralization.
- Keyboard navigation for dialogs/menus; trap focus appropriately.
- Announce live updates via `aria-live` regions or accessible toasts.

**Accessible toast provider**
```ts
// @/components/providers/toast-provider.tsx
'use client';
import { useEffect, useRef } from 'react';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (regionRef.current) {
      regionRef.current.setAttribute('role', 'status');
      regionRef.current.setAttribute('aria-live', 'polite');
    }
  }, []);
  return (
    <>
      <div ref={regionRef} aria-atomic='true' />
      {children}
    </>
  );
}
```

---

## 20) Testing Strategy

- **Unit (Jest):** validators, helpers, policies.
- **E2E (Playwright):** core user journeys; run on CI with Vercel preview URL.
- **Contracts:** Zod schemas as source-of-truth; generate types from them when possible.
- Each bug fix should include a failing test first.
- Each major route segment should include an `error.tsx` fallback; test it by simulating a rejected fetch.
- Add a contract test helper to assert public APIs always return the `ApiResponse` envelope.

```ts
// @/test/helpers/api.ts
import type { ApiResponse } from '@/types/api';

type SuccessBranch<T> = Extract<ApiResponse<T>, { success: true }>;
type ErrorBranch<T> = Extract<ApiResponse<T>, { success: false }>;

export function expectApiSuccess<T>(payload: ApiResponse<T>): asserts payload is SuccessBranch<T> {
  expect(payload.success).toBe(true);
}

export function expectApiError<T>(payload: ApiResponse<T>, code?: number): asserts payload is ErrorBranch<T> {
  expect(payload.success).toBe(false);
  if (code !== undefined) {
    expect(payload.error.code).toBe(code);
  }
}
```

---

## 21) Developer Ergonomics

- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test` must pass before merge.
- Conventional Commits (`feat:`, `fix:`, `chore:`…) *(see conventionalcommits.org)*. Auto-generate changelog when releasing.
- Provide a `.env.example` update in any PR that adds env vars.
- Keep `CHANGELOG.md` updated; document architectural decisions in the PR description and in `docs/` when they impact future work.
- Provide `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`, and `.github/pull_request_template.md` embedding the PR checklist.
- (Optional) Enforce Conventional Commits via `commitlint` in CI.
- (Optional) Add a schema drift check in CI to fail PRs that change `prisma/schema.prisma` without a corresponding migration and seed update.
- See **[17) Database & Seeds](#17-database--seeds)** for DB policies.

### 21.1) PR Checklist (quick)

- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run test` pass
- [ ] Runtime correct (**Edge** vs **Node**)
- [ ] Zod validation, rate-limit (IETF headers), and policy checks present
- [ ] Auth uses `auth()` from `@/lib/auth`
- [ ] Client uses `getCsrfToken()` from `@/lib/security/csrf`
- [ ] Basic a11y checks (focus, labels, contrast)
- [ ] Tests updated/added for critical flows
- [ ] Migration/seed included if schema changed
- [ ] `.env.example` updated if env vars changed



---

## 22) Using AI Assistants (this doc's audience)

- Generate **end-to-end slices** (schema → zod → route → UI → tests).
- Use **centralized helpers** (`@/lib/policy`, `@/lib/rate-limit`, `@/lib/slug`, `@/lib/env-server`, `@/lib/env-client`, `@/lib/auth`, `@/lib/security/csrf`).
- Emit **minimal diffs**: do not refactor unrelated code unless asked.
- If requirements conflict, **state the ambiguity** and implement the safest default.

**Answer style:** short rationale + the diff/snippet. Avoid repetition. If something seems underspecified, implement the smallest secure version and note assumptions inline.

---

## 23) Next.js Runtime & RSC Guidelines

- Prefer **Server Components**; add `'use client'` only for event handlers, drag-and-drop, presence, or client-only libraries.
- If a route or module uses Node-only APIs (e.g., `nodemailer`), set `export const runtime = 'nodejs'`.
- Public pages can use caching/ISR; **mutations must set `no-store`** and avoid caching.

### 23.1) Server state via `searchParams`
```ts
// app/(spaces)/page.tsx
export default async function Page({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const q = searchParams.q ?? '';
  const page = Number(searchParams.page ?? 1);
  // fetch using q/page and render
}
```
- Avoid client-only state for linkable concerns (filters, sort, pagination).

**Runtime choice guide**

| Use Edge when… | Use Node when… |
| --- | --- |
| You need ultra-low latency and simple fetch logic | You use Node-only libraries (Prisma, Nodemailer, AWS SDK) |
| You don't need heavy CPU or filesystem | You need stable TCP, filesystem, or larger memory |
| You want global CDN execution | You depend on `export const runtime = 'nodejs'` behaviors |

---

## 24) Cron Jobs & Scheduled Tasks

> **Goal:** Provide a public, example-only pattern for scheduled tasks on Vercel. Avoid leaking private business logic. Use placeholders and generic names.

### 24.1) Vercel Setup (Generic)

1. **Create a route** (App Router). Example path (placeholder): `app/api/cron/run/route.ts`.
2. **Set secrets** in Vercel → Project → Settings → Environment Variables:
   - `CRON_SECRET` → strong token. When set, Vercel injects `Authorization: Bearer <CRON_SECRET>` for cron calls.
   - **Production rule**: Always set `CRON_SECRET` in production. Do not rely on `x-vercel-cron` alone — headers can be spoofed.
   - Optional tuning knobs you *may* use: `CRON_IDEMPOTENCY_WINDOW_MINUTES`, `CRON_MAX_BATCH`, etc.
3. **Schedule the job** (UTC): keep a simple `vercel.json` in the repo (no secrets in the URL):
   ```json
   {
     "crons": [{ "path": "/api/cron/run", "schedule": "0 3 * * *" }]
   }
   ```
   Or, add it via the **Vercel Dashboard**. Do **not** put tokens in the URL; when `CRON_SECRET` is set, authentication arrives via the `Authorization` header.

> **Do not** commit secret-bearing URLs in public repos.

**Alternative:** Use a GitHub Actions schedule to call the endpoint and inject `${{ secrets.CRON_SECRET }}`.

```yaml
name: Example Cron
on:
  schedule: [ { cron: "0 3 * * *" } ] # UTC
  workflow_dispatch: {}
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/cron/run?dryRun=true"
    env:
      PROD_URL: https://your-domain.example
      CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

---

### 24.2) Route Skeleton (Example-Only)

_Clarifier:_ For destructive jobs, default to `?dryRun=true` outside production.

> Use **`Request`**, enforce **Node runtime**, validate with **Zod**, rate-limit with **IETF headers**, add **idempotency** and a **KV lock**, and always return `no-store` with the `ApiResponse<T>` envelope. The code below is a neutral template – replace names with your own.

```ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ApiResponse } from '@/types/api';
// Optional utilities (recommended pattern in this repo). If you don't use KV, remove the optional guards block below.
import { rateLimit, buildRateLimitHeaders, getRateLimitKey } from '@/lib/rate-limit';
import { kv } from '@vercel/kv';

// Example schema (adjust to your needs)
const querySchema = z.object({
  dryRun: z.union([z.literal('true'), z.literal('false')]).optional().transform((v) => v === 'true'),
});

export async function GET(req: Request) {
  // 1) Parse & validate input
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 400, message: 'Invalid query' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const q = parsed.data;

  // 2) Auth – Always set CRON_SECRET in production. When set, require Authorization: Bearer <CRON_SECRET>. If not set (local/dev only), accept x-vercel-cron as a weak signal (it is not an authenticity guarantee).
  const secret = process.env.CRON_SECRET;
  const byAuthHeader = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
  // NOTE: x-vercel-cron can be spoofed; treat it as a weak signal. Prefer CRON_SECRET in production.
  const isCronHeader = req.headers.get('x-vercel-cron') === '1' || req.headers.get('x-vercel-cron') === 'true';
  if (secret ? !byAuthHeader : !isCronHeader) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 403, message: 'Unauthorized' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 3) Optional guards – env-driven rate limit, idempotency window, and KV lock
  const rl = await rateLimit({ key: getRateLimitKey(req), policyId: 'cron.run' });
  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 429, message: 'Too many requests' } },
      { status: 429, headers: { ...buildRateLimitHeaders(rl), 'Cache-Control': 'no-store' } },
    );
  }

  const IDEM_WINDOW_MIN = Number(process.env.CRON_IDEMPOTENCY_WINDOW_MINUTES ?? '1');
  const slot = Math.floor(Date.now() / (IDEM_WINDOW_MIN * 60 * 1000));
  const ok = await kv.set(`cron:run:idem:${slot}`, '1', { nx: true, ex: IDEM_WINDOW_MIN * 60 });
  if (!ok) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 409, message: 'Duplicate within window' } },
      { status: 409, headers: { ...buildRateLimitHeaders(rl), 'Cache-Control': 'no-store' } },
    );
  }

  const lockOk = await kv.set('cron:run:lock', Date.now().toString(), { nx: true, ex: 600 });
  if (!lockOk) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 409, message: 'Job already running' } },
      { status: 409, headers: { ...buildRateLimitHeaders(rl), 'Cache-Control': 'no-store' } },
    );
  }

  try {
    // 4) Do your work here (example-only – no private business logic)
    // if (q.dryRun) { /* compute counts only */ }
    // else { /* perform limited, chunked work */ }

    return NextResponse.json<ApiResponse<{ ok: true }>>(
      { success: true, data: { ok: true } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    // NOTE: Log the real error server-side; never leak internals to clients.
    // e.g., logger.error(err as Error, 'cron failed');
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: { code: 500, message: 'Cron failed' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    // Best-effort: release locks if you acquired them
    // try { await kv.del('cron:run:lock'); } catch {}
  }
}
```

---

### 24.3) Safety Rules (Must Do)

- **Node runtime**: `export const runtime = 'nodejs'` (cron routes often use Node-only libs).
- **Auth first**: Require `Authorization: Bearer <CRON_SECRET>` when set; never commit secret URLs in public repos.
- **Validate** all inputs with Zod.
- **Rate limit** externally triggerable routes; emit **IETF headers** (`RateLimit-*`, not `X-RateLimit-*`).
- **Idempotency**: Use a KV key per time-window or a caller-supplied key.
- **KV lock**: Prevent overlapping executions.
- **`no-store`**: All mutation responses must set `Cache-Control: no-store`.
- **Logs**: Emit structured logs (but avoid PII/secrets).
- **Prod-only destructive**: Default to `dryRun` outside production.

---

### 24.4) Testing & Troubleshooting (Generic)

- **Local dry run** (no secret):
  ```bash
  curl -s -H "x-vercel-cron: 1" 'http://localhost:3000/api/cron/run?dryRun=true'
  ```
- **With secret (simulate Vercel):**
  ```bash
  export CRON_SECRET=$(openssl rand -hex 16)
  curl -s -H "Authorization: Bearer $CRON_SECRET" 'http://localhost:3000/api/cron/run?dryRun=true'
  ```
- **Common errors**
  - `403 Unauthorized`: missing/invalid `Authorization` (when `CRON_SECRET` is set) or missing `x-vercel-cron` (when it is not).
  - `409 conflict (job already running)`: KV lock held; another run active.
  - `409 conflict (duplicate within idempotency window)`: same window/key recently executed.
  - `429 rate_limited`: wait per `Retry-After` header.

---

## Appendix: Missing Implementations Checklist

This playbook references several helpers you should ensure exist (or be created) in the repository. Here's a quick checklist:

**Security & Auth:**
- [ ] `@/lib/security/csrf` - CSRF token generation and validation
- [ ] `@/lib/auth` - NextAuth config exporting `{ auth, handlers }`
- [ ] `@/lib/policy` - Authorization/role checking helpers

**Infrastructure:**
- [ ] `@/lib/rate-limit` - Rate limiting with IETF headers
- [ ] `@/lib/idempotency` - DB-backed idempotency (withIdempotencyJson) with per-user scope (or 'global' sentinel)
- [ ] `@/lib/database` - Prisma client with driver adapter
- [ ] `@/lib/logger` - Structured logging with correlation IDs
- [ ] `@/lib/events` - Event tracking with PII redaction

**Utilities:**
- [ ] `@/lib/env-server` - Type-safe server environment variables
- [ ] `@/lib/env-client` - Type-safe client environment variables  
- [ ] `@/lib/slug` - Slug generation utilities
- [ ] `@/lib/api` - API response helpers (apiError, etc.)

**Configuration:**
- [ ] `prisma.config.ts` - Prisma 7 configuration
- [ ] `.env.example` - Documented environment variables

Implement these helpers following the patterns shown in this playbook before generating feature code.