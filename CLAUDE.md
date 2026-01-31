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
│   │   ├── server.ts   # server-side route helpers (withApi, api)
│   │   ├── shapes.ts   # Result, ApiEnvelope, ApiError types
│   │   └── errors.ts   # error parsing for forms (parseApiProblem)
│   ├── auth/           # authentication
│   │   ├── auth.ts     # NextAuth config
│   │   └── policy.ts   # authorization helpers
│   ├── db/             # database
│   │   └── database.ts # Prisma client singleton
│   ├── env/            # environment
│   │   ├── client.ts   # typed client env (NEXT_PUBLIC_*)
│   │   └── server.ts   # typed server env
│   ├── security/       # security utilities
│   │   ├── csrf.ts     # CSRF helpers
│   │   └── rate-limit.ts
│   └── logger.ts       # structured logging
└── test/               # unit & e2e tests
```

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

**Exceptions**
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth handler (framework-required); do not wrap with CSRF/idempotency guards
- Cron routes under `/api/cron/<verb>` may use `GET`; do not use CSRF (machine-to-machine)

**Mandatory Security Guards (every route)**

Use `withApi()` or `api()` from `@/lib/api/server` which handles:
1. Method validation
2. Authentication (`auth: 'public' | 'auth' | 'onboarded'`)
3. Origin check (same-origin)
4. CSRF validation (POST)
5. Content-Type validation (POST)
6. Rate limiting (IETF headers)
7. Payload parsing + size limits
8. Zod schema validation
9. Idempotency key extraction

## API Types

```ts
// @/lib/api/shapes.ts

// Result type for internal domain code
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// API envelope for HTTP responses
export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export type ApiError = {
  code: string;
  message: string;
  status: number;
  issues?: ApiIssue[];  // for validation errors
  meta?: unknown;       // safe-to-expose context
};

export type ApiIssue = {
  path: Array<string | number>;
  message: string;
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

  // ctx provides: req, session, viewerId, handle, json, idempotencyKey, ifMatch
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

These helpers handle CSRF tokens, idempotency keys, credentials, timeouts, and retry on CSRF failure.

**Server Components** — call data layer directly (no HTTP needed):
```ts
// In a Server Component
import { db } from '@/lib/db/database';

const spaces = await db.space.findMany({ where: { ownerId } });
```

## Auth Pattern

```ts
import { auth } from '@/lib/auth/auth';

const session = await auth();
if (!session?.user?.id) {
  return errJson({ code: 'UNAUTHORIZED', message: 'Sign in required.', status: 401 });
}
```

Or use `withApi()` with `auth: 'auth'` or `auth: 'onboarded'` to handle this automatically.

- All authorization checks via `@/lib/auth/policy` helpers
- Never check roles on client to gate server operations

## Forms

Use `@/components/ui/form.tsx` for form components. Handle API errors with `parseApiProblem`:

```tsx
'use client';

import { apiPost } from '@/lib/api/client';
import { parseApiProblem } from '@/lib/api/errors';

async function handleSubmit(formData: FormData) {
  const result = await apiPost('/api/spaces/create', {
    name: formData.get('name'),
  });

  if (!result.ok) {
    const { fieldErrors, formError } = parseApiProblem(result.error);
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
- `src/lib/db/database.ts` — PrismaClient singleton with driver adapter

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
- [ ] Zod validation at boundary (via `withApi` or `api`)
- [ ] Rate limit with IETF headers
- [ ] Auth mode set correctly (`public`, `auth`, `onboarded`)
- [ ] API calls use `apiGet` / `apiPost` (not raw fetch)
- [ ] Basic a11y (focus, labels, contrast)
- [ ] Tests updated/added for critical flows
- [ ] Migration + seed if schema changed
- [ ] `.env.example` updated if env vars changed
