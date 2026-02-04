# Next.js Development Playbook

> Project-specific conventions for Next.js apps. Inherits from global `~/.claude/CLAUDE.md`.
>
> **Usage:** Copy this file to your project root as `CLAUDE.md`.

## Stack Versions

- Next.js **16.x** (App Router) + React **19.2**
- Node.js **22.x** (Next.js 16 requires Node 20.9+)
- TypeScript **5.x** (min 5.1)
- Prisma **7.x** (default @prisma/client output)
- NextAuth **v5** (`AUTH_*` env vars)
- Tailwind CSS **4.x**, Zod **4.x**
- Optional: Shadcn with Base UI primitives, Ably, Vercel KV

> If versions conflict between this doc and `package.json`, the lockfile wins.

## Build & Dev

- **Dev**: `npm run dev` (Turbopack by default in Next.js 16)
- **Debug**: If HMR/CSS issues, try `next dev --webpack` to isolate Turbopack bugs
- **Build**: `npm run build` (`prisma generate && next build`)
- **Quality gates**: `npm run format:check && npm run lint && npm run typecheck && npm run test`

## Runtime

Set `export const runtime = 'nodejs'` when using Node-only APIs:
- API routes using Prisma, Nodemailer, AWS SDK
- Pages with heavy server-side processing
- Any route using `@/lib/database`

Default to Node.js runtime unless you specifically need Edge (ultra-low latency, simple fetch logic).

## Repository Layout

```
docs/                   # documentation
emails/                 # transactional email templates (React Email)
prisma/                 # schema.prisma, seeds, migrations
src/
├── app/                # Next.js App Router
│   ├── (auth)/         # auth pages (route group)
│   ├── (marketing)/    # brand, terms, blog
│   ├── api/            # route handlers
│   ├── globals.css     # root styles and Tailwind imports
│   ├── layout.tsx      # root layout
│   └── providers.tsx   # global client-only providers (wrapped in layout)
├── components/         # UI components
│   ├── ui/             # reusable primitives (button, input, modal, form)
│   ├── layout/         # shell, nav, footer, sidebar
│   └── [feature]/      # domain-specific (add as needed)
├── config/             # persistent constants
├── hooks/              # custom hooks (client-safe)
├── lib/                # core utilities
│   ├── api/            # API layer
│   │   ├── client.ts   # client-side API calls (apiGet, apiPost)
│   │   ├── server.ts   # server-side route helpers (api, okJson, errJson)
│   │   ├── shapes.ts   # Result, ApiEnvelope, ApiError types
│   │   └── errors.ts   # error parsing for forms (parseApiError)
│   ├── auth/           # authentication
│   │   ├── session.ts  # NextAuth config
│   │   └── policy.ts   # authorization helpers
│   ├── db/             # database
│   │   └── client.ts   # Prisma client singleton
│   ├── env/            # environment
│   │   ├── client.ts   # typed client env (NEXT_PUBLIC_*)
│   │   └── server.ts   # typed server env
│   ├── security/       # security utilities
│   │   ├── csrf.ts     # CSRF helpers
│   │   └── rate-limit.ts
│   └── logger.ts       # structured logging
└── test/               # unit & e2e tests
```

## API Layer Naming Convention

All types, schemas, and functions in `src/lib/api/` follow consistent naming:

| Category | Pattern | Examples |
|----------|---------|----------|
| Schemas | `*Schema` | `ApiErrorSchema`, `ApiIssueSchema` |
| Types (API) | `Api*` | `ApiError`, `ApiEnvelope`, `ApiContext`, `ApiMethod`, `ApiAuthMode` |
| Types (Auth) | `Auth*` | `AuthError`, `AuthErrorCode`, `AuthResult` |
| Type Guards | `is*` | `isApiEnvelope`, `isApiError` |
| Envelope factories | `api*` | `apiOk`, `apiErr` |
| Result factories | `ok`, `err` | `ok(value)`, `err(error)` |
| Response helpers | `*Json` | `okJson`, `errJson` |
| Error parsers | `parse*` | `parseApiError` |

**Files:**
- `shapes.ts` — Core types: `Result`, `ApiEnvelope`, `ApiError`, `ApiIssue`, schemas, type guards
- `errors.ts` — Form error parsing: `ApiFormError`, `parseApiError`
- `server.ts` — Server middleware: `api`, `okJson`, `errJson`, `ApiContext`, `ApiOptions`
- `client.ts` — Client helpers: `apiGet`, `apiPost`

## API Route Convention

**Rules**
- Only `GET` and `POST`
- `GET` for reads: `GET /api/<resource>/list` or `GET /api/<resource>/get?id=xxx`
- `POST` for mutations: `POST /api/<resource>/<verb>`
- Common verbs: `create`, `update`, `delete`, `archive`, `restore` — use the clearest verb for the action
- No IDs in URL paths — pass in query params (GET) or body (POST)
- Max 3 path segments after `/api`

**Examples**
- ✅ `GET /api/spaces/list?cursor=...&q=...`
- ✅ `GET /api/spaces/get?id=...`
- ✅ `POST /api/spaces/create` `{ "name": "..." }`
- ✅ `POST /api/spaces/update` `{ "id": "...", "patch": { ... } }`
- ❌ `GET /api/spaces/123`
- ❌ `PATCH /api/spaces/123`

**GET schemas:** Query params are always strings. Use `z.coerce.*` for non-string types:

```ts
// GET /api/users/list?page=1&limit=20
const schema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
});
```

**Exceptions**
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth handler (framework-required); do not wrap with CSRF/idempotency guards
- Cron routes under `/api/cron/<verb>` may use `GET`; do not use CSRF (machine-to-machine)

**Mandatory Security Guards (every route)**

Use `api()` from `@/lib/api/server` which handles:
1. Method validation
2. Authentication (`auth: 'public' | 'auth' | 'onboarded'`)
3. Origin check (same-origin)
4. CSRF validation (POST) — uses `requireCsrf()` which returns `Result<null, CsrfProblem>`
5. Content-Type validation (POST)
6. Rate limiting (IETF headers)
7. Payload parsing + size limits
8. Zod schema validation
9. Idempotency key extraction

## Schema-First Pattern

**Always define Zod schemas first, derive types from them.** This is the industry standard:

1. Define schema once (single source of truth)
2. Derive TypeScript type from schema (`z.infer<typeof Schema>`)
3. Use schema for runtime validation (`schema.safeParse()`)

```ts
// ✅ Correct: Schema-first
const UserSchema = z.object({ name: z.string(), email: z.string().email() });
type User = z.infer<typeof UserSchema>;

// Runtime validation
const result = UserSchema.safeParse(input);
if (result.success) {
  const user: User = result.data;
}

// ❌ Wrong: Type-first with manual type guards
type User = { name: string; email: string };
function isUser(v: unknown): v is User {
  return typeof v === 'object' && v !== null && 'name' in v && 'email' in v;
}
```

**Exception — Generic types for compile-time narrowing:**

When you need domain-specific type narrowing at compile time, keep generics on the type but use the base schema for runtime validation:

```ts
// Schema validates the base shape
const ApiErrorSchema = z.object({ code: z.string(), message: z.string(), status: z.number() });

// Type uses generics for compile-time narrowing
type ApiError<Code extends string = string, Status extends number = number> = {
  code: Code; message: string; status: Status;
};

// Domain-specific error with narrowed types
type AuthError = ApiError<"AUTH_REQUIRED" | "ONBOARDING_REQUIRED", 401 | 428>;

// Runtime validation still uses the base schema
const parsed = ApiErrorSchema.safeParse(thrown);
```

## API Types

```ts
// @/lib/api/shapes.ts — Zod schemas + derived types

// Result type for internal domain code (simple discriminated union)
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
function ok<T>(value: T): Result<T, never>;
function err<E>(error: E): Result<never, E>;

// API schemas — single source of truth (Zod-first)
const ApiIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  status: z.number(),
  issues: z.array(ApiIssueSchema).optional(),
  meta: z.unknown().optional(),
});

// Derived types from schemas
type ApiIssue = z.infer<typeof ApiIssueSchema>;

// ApiError keeps generics for compile-time narrowing
// Runtime validation uses ApiErrorSchema.safeParse()
type ApiError<
  Code extends string = string,
  Status extends number = number,
  Meta = unknown
> = {
  code: Code;
  message: string;
  status: Status;
  issues?: ApiIssue[];
  meta?: Meta;
};

// API envelope for HTTP responses
type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
function apiOk<T>(data: T): ApiEnvelope<T>;
function apiErr(error: ApiError): ApiEnvelope<never>;

// Type guard uses Zod for runtime validation
function isApiEnvelope(v: unknown): v is ApiEnvelope<unknown>;

// @/lib/api/errors.ts — UI-friendly error parsing
// Note: ApiFormError is an output type (we construct it), not input

type ApiFormError = {
  fieldErrors: Record<string, string>;
  formError?: string;
  code?: string;
  status?: number;
  meta?: unknown;
};
function parseApiError(error: unknown): ApiFormError;

// @/lib/api/server.ts — server-side types
type ApiMethod = "GET" | "POST";
type ApiAuthMode = "public" | "auth" | "onboarded";
type ApiContext<T> = {
  req: NextRequest;
  session: Session | null;
  viewerId: string | null;
  handle: string | null;
  json: T;
  idempotencyKey: string | null;
  ifMatch: string | null;
  requestId: string;
  authMode: ApiAuthMode; // for observability/logging
};
```

Always return `ApiEnvelope<T>`. Never leak stack traces to clients.

## API Route Pattern

```ts
// src/app/api/spaces/create/route.ts
import { api, okJson, errJson } from '@/lib/api/server';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1).max(100),
});

export const POST = api(schema, async (ctx) => {
  const { viewerId, json } = ctx;

  // ctx provides: req, session, viewerId, handle, json, idempotencyKey, ifMatch, requestId
  const space = await createSpace({ name: json.name, ownerId: viewerId });

  return okJson({ space });
}, { auth: 'onboarded' });
```

## API Client Usage

**Never use raw `fetch` in components.** Use the canonical API helpers:

```ts
// Client components: @/lib/api/client
import { apiGet, apiPost } from '@/lib/api/client';

// GET request
const result = await apiGet<Space[]>('/api/spaces/list', { cursor, q });

// POST request
const result = await apiPost<{ space: Space }>('/api/spaces/create', { name });

// Result handling (never throws)
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

**Features:**
- CSRF tokens (auto-attached to POST, retry on 419)
- Timeout (30s default, configurable)
- Network retry with exponential backoff (2 retries default for 502/503/504)
- Request IDs (`X-Request-ID` header for tracing)
- Idempotency keys (via `idempotencyKey` option)
- If-Match headers (via `ifMatch` option for optimistic concurrency)

**Options:**
```ts
await apiPost('/api/users/create', body, {
  timeoutMs: 10_000,       // Override timeout (0 to disable)
  maxRetries: 0,           // Disable network retry
  idempotencyKey: 'abc',   // For safe retries
  ifMatch: '"etag"',       // Optimistic concurrency
  csrf: false,             // Skip CSRF (for webhooks)
});
```

**Server Components** — call data layer directly (no HTTP needed):
```ts
// In a Server Component
import { db } from '@/lib/db/client';

const spaces = await db.space.findMany({ where: { ownerId } });
```

## Auth Pattern

```ts
// @/lib/auth/policy.ts — schema-first auth errors

// Zod schema is single source of truth
const AuthErrorSchema = z.object({
  code: z.enum(["AUTH_REQUIRED", "ONBOARDING_REQUIRED"]),
  message: z.string(),
  status: z.union([z.literal(401), z.literal(428)]),
});

type AuthErrorCode = "AUTH_REQUIRED" | "ONBOARDING_REQUIRED";
type AuthError = ApiError<AuthErrorCode, 401 | 428>;
type AuthResult<T> = Result<T, AuthError>;

// Guards throw AuthError, caught and validated in api/server.ts
async function requireAuth(): Promise<{ session: Session; userId: string }>;
async function requireOnboarded(): Promise<{ session: Session; userId: string; handle: string }>;

// Redirect helpers for Server Components
async function requireAuthRedirect(returnToUrl?: string): Promise<...>;
async function requireOnboardedRedirect(returnToUrl?: string): Promise<...>;
```

**Usage in API routes:** Use `api()` with `auth: 'auth'` or `auth: 'onboarded'`:

```ts
export const POST = api(schema, handler, { auth: 'onboarded' });
```

**Usage in Server Components:**

```ts
import { requireOnboardedRedirect } from '@/lib/auth/policy';

export default async function Page() {
  const { userId, handle } = await requireOnboardedRedirect();
  // ...
}
```

- All authorization checks via `@/lib/auth/policy` helpers
- Never check roles on client to gate server operations
- Auth errors use `AuthErrorSchema.safeParse()` for runtime validation in `api/server.ts`

## Forms

Use `@/components/ui/form.tsx` for form components. Handle API errors with `parseApiError`:

```tsx
'use client';

import { apiPost } from '@/lib/api/client';
import { parseApiError } from '@/lib/api/errors';

async function handleSubmit(formData: FormData) {
  const result = await apiPost('/api/spaces/create', {
    name: formData.get('name'),
  });

  if (!result.ok) {
    const { fieldErrors, formError } = parseApiError(result.error);
    // fieldErrors: { name: 'Name is required' }
    // formError: 'Something went wrong'
    return;
  }

  // Success
  router.push(`/spaces/${result.value.space.id}`);
}
```

## Error Handling (Client)

- Add `error.tsx` to route segments for graceful error recovery
- Add `not-found.tsx` for 404 states
- Use `loading.tsx` or Suspense for loading states

```tsx
// app/spaces/error.tsx
'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

## Database & Prisma

**Config files**
- `prisma/schema.prisma` — models only
- `prisma.config.ts` — datasource URL via `env('DATABASE_URL')`
- `src/lib/db/client.ts` — PrismaClient singleton with driver adapter

**Migration policy**
- Any schema change must ship with migration in same PR
- Migration names: `add-<model>`, `rename-<field>`, `drop-<table>`
- Seeds must be idempotent (use `upsert`)

**Scripts**
- `npm run db:generate` — regenerate client
- `npm run db:create` — create migration without applying (for manual SQL functions)
- `npm run db:migrate` — apply migrations
- `npm run db:seed` — run seeds
- `npm run db:reset` — reset and re-seed

## Environment Variables

**Server** (`@/lib/env/server`): `DATABASE_URL`, `AUTH_SECRET`, `ABLY_API_KEY`, `EMAIL_SERVER_*`, `R2_*`
**Client** (`@/lib/env/client`): `NEXT_PUBLIC_DEBUG`, `NEXT_PUBLIC_LOG_LEVEL`

Auth.js uses `AUTH_*` prefix (not `NEXTAUTH_*`).

## Integrations

**File Uploads (R2)**
- Presigned URLs only, short TTL (60-300s)
- Validate MIME on both client and server
- Prefix keys with user scope: `${userId}/...`

**Real-time (Ably)**
- Include `eventId` + `clientId` for idempotency
- Mint tokens server-side with scoped capabilities
- Never expose API keys in client

**Email (React Email + Nodemailer)**
- Templates in `emails/`
- Set `export const runtime = 'nodejs'` for routes using Nodemailer

**Caching (Vercel KV)**
- Use for computed/expensive reads, rate limits, feature flags
- Not a source of truth for relational data
- TTL everything; no PII

## Logging

```ts
import { logger } from '@/lib/logger';

logger.info('message', { context });
logger.error(err, 'failed');
```

- Never use `console.log` — use `@/lib/logger` everywhere (server and client)
- Include request correlation ID
- Redact PII; never log secrets

## Cron Jobs

**Setup**
1. Create route: `app/api/cron/<verb>/route.ts`
2. Set `CRON_SECRET` in Vercel environment variables
3. Schedule in `vercel.json` (no secrets in URL):

```json
{
  "crons": [{ "path": "/api/cron/run", "schedule": "0 3 * * *" }]
}
```

> **Do not** commit secret-bearing URLs in public repos. When `CRON_SECRET` is set, Vercel sends `Authorization: Bearer <CRON_SECRET>` header automatically.

**Route requirements**
- Auth: Verify `Authorization: Bearer <CRON_SECRET>` header
- Rate limit with IETF headers
- Always `Cache-Control: no-store`
- Default to `?dryRun=true` outside production
- For complex crons: use database-level idempotency (check "last run" timestamp)

## Performance & Caching

- Parallelize independent awaits; avoid synchronous waterfalls
- Use `select` to return only necessary fields from Prisma
- Use `<Image />` with `sizes` and `priority` props
- Prefer dynamic imports for code splitting heavy client bundles
- Use Suspense to stream expensive sections

**Data caching with `use cache` (Next.js 15+):**

```ts
import { cacheTag, revalidateTag } from 'next/cache';

export async function getSpace(id: string) {
  'use cache';
  cacheTag(`space:${id}`);

  return db.space.findUnique({ where: { id } });
}

// Invalidate after mutation
revalidateTag(`space:${id}`);
```

> Prefer calling your data layer directly in Server Components instead of self-fetching an API route.

## Component Styling

- Always expose a `className` prop for customization
- Structure classes: layout → spacing → color → state → modifiers
- Keep responsive classes mobile-first (`sm:`, `md:`, `lg:`)
- Use Base UI `data-[state]` attributes for states (e.g., `data-[state=open]:opacity-100`)
- Consolidate variant styles with `cva` when components have many permutations

## State Management

**Local UI state**
- `useState` for simple, colocated state
- `useReducer` for complex state or when multiple fields change together
- `useOptimistic` for simple optimistic UI flows
- Initialize state explicitly; avoid implicit `any`

**Server vs client state**
- Prefer Server Components and server fetching
- Avoid duplicating server state in client stores — derive UI state from responses
- Use tag-based caching and `revalidateTag()` on mutations

## Security Essentials

- Validate all inputs with Zod on server
- Use parameterized queries via Prisma; add indices/unique constraints
- Enforce CSRF-safe patterns (Route Handlers + same-site cookies)
- Set security headers in root layout and/or `proxy.ts`
- Sanitize any HTML; never trust user content
- No long-lived secrets in CI; prefer short-lived tokens
- Rotate credentials quarterly or upon offboarding

## CSRF Protection

**Architecture:** Double-submit cookie scheme with token rotation
- Server sets an httpOnly CSRF cookie
- Client fetches token via `GET /api/security/csrf` and echoes it in request header
- Server validates header matches cookie (timing-safe comparison)
- Token rotates on every successful mutation (defense in depth)

**Files:**
- `@/lib/security/csrf.ts` — Server-side CSRF helpers
- `@/lib/api/client.ts` — Client auto-attaches CSRF token to POST requests
- `@/components/providers.tsx` — `CsrfManager` handles lifecycle

**Constants:**
- Header name: `X-CSRF-Token`
- Rotation header: `X-CSRF-Token-Refresh`
- Cookie name: `__Host-orbyt-csrf` (prod) / `orbyt-csrf` (dev)
- Token endpoint response: `{ csrfToken: string }`

**Server usage:**

```ts
import { requireCsrf } from '@/lib/security/csrf';

// Returns Result<null, CsrfProblem> — never throws
const csrfResult = requireCsrf(req);
if (!csrfResult.ok) {
  return errJson({ code: 'CSRF_FAILED', message: csrfResult.error.message, status: csrfResult.error.status });
}
```

> **Note:** The `api()` middleware handles CSRF automatically for POST requests. Use `requireCsrf` directly only for custom route handlers outside the `api()` pattern.

**Client usage:**

```ts
import { apiPost } from '@/lib/api/client';

// CSRF token auto-attached (fetched on first POST, cached, retried on 419)
const result = await apiPost('/api/resource/create', { data });
```

**Key behaviors:**
- `apiPost` automatically fetches and caches CSRF token
- On 419 (CSRF failure), client resets token and retries once
- Use `csrf: false` option to skip CSRF (for webhooks/machine-to-machine)
- **Token rotation**: Server sends new token via `X-CSRF-Token-Refresh` header on successful POST; client auto-updates cache
- **Session binding**: Token resets on login/logout/user switch via `CsrfManager`
- **Visibility refresh**: Token resets when tab becomes visible (handles stale tabs)
- Use `rotateCsrf: false` option to disable rotation for specific endpoints

## Neon + Prisma (Vercel)

- Keep Prisma on **Node.js runtime** (not Edge)
- Use Neon's **pooled** connection string for serverless
- Run `prisma migrate` in Node.js contexts only (local dev, CI, serverless function)
- When using `@auth/prisma-adapter`, ensure handlers run on Node.js runtime

**Rollback & recovery**
- Prefer forward-only migrations; write follow-up migrations for hotfixes
- Document breaking changes and rollback steps in PR + `CHANGELOG.md`

## Developer Ergonomics

- Quality gates must pass before merge
- Use Conventional Commits (`feat:`, `fix:`, `chore:`)
- Update `.env.example` when adding env vars
- Keep `CHANGELOG.md` updated
- Document architectural decisions in PR descriptions and `docs/`

## PR Checklist

- [ ] Quality gates pass (`format:check`, `lint`, `typecheck`, `test`)
- [ ] Runtime set correctly (`export const runtime = 'nodejs'` where needed)
- [ ] Zod validation at boundary (via `api`)
- [ ] Rate limit with IETF headers
- [ ] Auth mode set correctly (`public`, `auth`, `onboarded`)
- [ ] API calls use `apiGet` / `apiPost` (not raw fetch)
- [ ] Basic a11y (focus, labels, contrast)
- [ ] Tests updated/added for critical flows
- [ ] Migration + seed if schema changed
- [ ] `.env.example` updated if env vars changed
