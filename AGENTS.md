# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Atlas is a Next.js 16 (App Router, Turbopack) community platform. It is a single-service app — no Docker, no local database. The database is Neon (cloud-hosted Postgres) accessed via `@prisma/adapter-neon` over WebSockets.

### Environment variables

Both `.env` and `.env.local` must exist with identical content. Next.js reads `.env.local`; Prisma's `prisma.config.ts` imports `dotenv/config` which only reads `.env`. Both are gitignored.

Required env vars for the app to start: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`. See `.env.example` for the full list.

### npm install caveat

The `postinstall` script runs `prisma generate`, which requires `DATABASE_URL_UNPOOLED` to be set. If `.env` does not exist yet, install with the env var inline:

```
DATABASE_URL_UNPOOLED="postgresql://placeholder@localhost/x" npm install
```

### Running the dev server

```
npm run dev
```

Starts on port 3000 with Turbopack. The app renders even without a real database — pages that don't hit the DB (e.g. `/signin`) load fine, but DB-dependent pages will error at runtime.

### Quality gates

Standard commands are in `package.json`:

- **Lint**: `npx eslint .` (the `npm run lint` / `next lint` command has issues in Next.js 16; use `npx eslint .` directly)
- **Typecheck**: `npm run typecheck`
- **Format**: `npm run format:check`

Pre-existing lint warnings/errors and format issues exist in the codebase; these are not regressions.

Test files reference `vitest` but it is not installed as a dependency — `npm run typecheck` will report errors in `*.test.ts` files; these are pre-existing.

### Database

No local Postgres is needed. The app connects to a remote Neon instance. Prisma commands (`db:migrate`, `db:generate`, etc.) are documented in `package.json` scripts. `prisma generate` only needs the schema (no DB connection); `prisma migrate dev` requires a real `DATABASE_URL_UNPOOLED`.
