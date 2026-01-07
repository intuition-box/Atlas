# Orbyt — Community Platform

A community directory where people sign to join communities, fill an application, get reviewed by admins, and then appear as orbiting members around each community. Orbyt is designed for communities and teams that need both **organization** and **engagement**. It blends social features (user profile, friendship, attestations) with productivity patterns (quests, tasks, roles) and delivers near real‑time participation.

Orbyt is a visual summary of a member’s relationship to a community. Hovering a member pauses rotation and shows a tooltip. Clicking takes you to their profile.

### Orbyt layers

We keep four orbit levels (rings), from closest to farthest:

1. **Advocates** (closest)
2. **Contributors**
3. **Participants**
4. **Explorers** (outermost)

In the orbit visualization:

- **Ring (distance)** = Orbit Level
- **Dot size** = Reach
- **Dot brightness** = Recency (based on `lastActiveAt`)

This repo is an MVP scaffold designed to be simple, fast to iterate on, and safe to grow into more advanced identity/graph features later.

---

## Gravity, Love, Reach

This project intentionally treats **facts/attestations** as first-class actions, and uses them to compute human-readable orbit metrics.

### Definitions

- **Reach**: “How visible / referenced is this member in the community?”
  - Higher when the member is frequently attested to.
  - Used primarily for **node size** in the orbit.

- **Love**: “How strong is the relationship signal around this member?”
  - Higher when the member both participates and receives positive attestations.
  - Used to help determine **orbit level**.

- **Gravity**: “How strongly does the community ‘pull’ around this member?”
  - A community-relative score combining relationship + participation signals.
  - Used as a stabilizer for **orbit level** and for future features (e.g. sorting, recommendations).

### How scores are computed (MVP)

All scoring logic lives in:

- `src/lib/scoring.ts`

The MVP uses **pure Prisma queries** and is optimized to support batching (including `groupBy`) so we can recompute efficiently when:

- an application is approved/rejected
- an attestation is created
- an admin overrides orbit level

**Current scoring is heuristic** and may evolve, but the intent is consistent:

- Reach increases with attestations received.
- Love increases with relationship signals (attestations given/received), with small role/approval boosts.
- Gravity represents a combined “pull” signal, derived from Love/Reach and community-relative normalization.

### Orbit level assignment

Orbit level is computed from Love/Reach thresholds (community-relative buckets), unless an admin has set an override.

- `orbitLevelOverride` (if present) wins.
- otherwise `orbitLevel` is recomputed by the scoring module.

> Admin overrides are audited via `ActivityEvent`.

---

## Membership, roles, and permissions

### Membership status

- `PENDING` — joined, not yet approved
- `APPROVED` — visible in the directory
- `REJECTED` — application rejected
- `BANNED` — cannot join or reapply

### Roles

Roles are ranked for authorization checks (lower number = more power):

- `OWNER` (0)
- `ADMIN` (1)
- `MODERATOR` (2)
- `MEMBER` (3)

Utilities live in:

- `src/lib/permissions.ts`

The helper `hasAtLeastRole()` (and server guards like `requireCommunityRole`) enforce access.

---

## Handles

We intentionally dropped “slug” and keep a single concept: **handle**.

Handles are used for:

- routes (community pages, optionally user pages)
- UI display

Handles are **not** used as foreign keys or identifiers for writes. All writes use IDs.

### Handle policy (Option B: best UX + safe)

- Handles can be changed.
- When a handle is changed:
  - the old handle returns **404** (no redirects).
  - the previous owner can switch back to the old handle after **1 week**.
- Old handles become publicly available after **1 month**.
- Deleting a user/community **does not free the handle**; it becomes **RETIRED** forever and returns **404**.

Handle utilities live in:

- `src/lib/handle.ts`

---

## Attestations (facts)

Attestations are the MVP’s “facts” layer. A member can attest about another member inside a community.

Examples:

- worked together
- know IRL
- role claims (developer/artist/etc)

MVP rule:

- both users must be **approved members** of the same community

API routes:

- Create: `POST /api/attestation/create`
- List: `GET /api/attestation/list?communityId=...&userId=...`

Long-term: these attestations can be minted to Intuition Protocol. This is intentionally deferred.

---

## 1) Core loop

1. **Sign in with Discord** OAuth (more platform support in the future).
2. **Create a community** (owner becomes an approved member).
3. **Join a community** → creates a pending membership.
4. **Submit an application** → goes to the community dashboard.
5. **Admins review** → approve/reject.
6. **Approved members appear in the orbit** (homepage + community page).
7. **Members can create attestations** about other members (worked together, know IRL).
7. **Members can complete quests** which will gorw their love (complete profile, refer, join community socials, and more).

> **Security is the gatekeeper.** If a trade‑off exists, choose the most secure option and call it out. See **AGENTS.md** for the full engineering playbook for AI coding tools and humans alike.

---

## 2) Core capabilities

- **Posts + Comments:** Drag‑and‑drop workflows; discussion stays attached to each post or quest.
- **Communities & Memberships:** Multi‑tenant isolation with roles and policies.
- **Realtime Presence:** Live updates for chat, updates, and presence via Ably.
- **Rich Editor:** TipTap‑based editor with links, placeholders, and sensible formatting.
- **Uploads:** Direct‑to‑object‑storage (Cloudflare R2) via **presigned URLs**; no files stored on the app server.
- **Email:** Transactional emails rendered with React Email + Nodemailer.
- **Accessibility:** Keyboard‑first UX and semantic components (shadcn/ui + Base UI).
- **API Envelope:** Consistent `ApiResponse<T>` across public APIs.
- **Rate limiting:** IETF headers (`RateLimit`, `RateLimit-Policy`) + legacy mirrors; `Retry-After` on 429.

---

## 3) Tech stack

- **Hosting**: Vercel
- **Framework**: Next.js 16 (App Router)
- **Database**: Neon (Postgres)
- **ORM**: Prisma v7
- **Auth**: NextAuth v5 (Auth.js)
- **UI**: shadcn/ui (Base UI flavor) + Tailwind CSS v4
- **Forms**: React Hook Form
- **Files**: Cloudflare R2 (signed uploads)
- **API style**: Verb-based routes, shallow route depth (aim: ≤ 3 levels)
- **Real-time**: Ably v2 (*optional in local dev*)

---

## 4) Quick Start (Local)

1. **Clone** the repository.
2. **Copy env**: `cp .env.example .env.local` and fill at least:
  - `DATABASE_URL` (Neon Postgres pooled connection string)
  - `DATABASE_URL_UNPOOLED` (Unpooled/direct connection string used by migrate)
  - `AUTH_SECRET` (generate with `openssl rand -hex 32`)
  - `AUTH_URL` (e.g., `http://localhost:3000`)
  - `AUTH_DISCORD_ID`
  - `AUTH_DISCORD_SECRET`
  - *(optional)* `ABLY_API_KEY`, `EMAIL_FROM`, R2 credentials (`R2_*`), etc.
3. **Install & set up DB**
  ```bash
  npm install
  npm run db:generate
  npm run db:migrate
  ```
4. **Run**
  ```bash
  npm run dev
  # or
  yarn dev
  # or
  pnpm dev
  # or
  bun dev
  ```
5. Visit **http://localhost:3000**, log in, and explore.

**Scripts**

- `npm run dev` — Next.js dev server (Turbopack)
- `npm run build` — `prisma generate && next build`
- `npm run start` — start production server
- `npm run lint` / `npm run lint:fix` — ESLint (no warnings allowed)
- `npm run format:check` / `npm run format` — Prettier
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:*` — Prisma workflows (`generate`, `migrate`, `seed`, `reset`)

---

## 5) Configuration

Orbyt validates environment variables with **Zod** and splits them into **server**/**client** modules:

- **Server:** `@/lib/env-server` — secrets and server‑only values (e.g., `DATABASE_URL`, `AUTH_SECRET`, Email, R2).
- **Client:** `@/lib/env-client` — read‑only `NEXT_PUBLIC_*` values.

Minimum for local dev (subset):
| Name | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string (pooled, with SSL) |
| `AUTH_SECRET` | 32+ char secret for NextAuth |
| `AUTH_URL` | Your site origin (e.g., `http://localhost:3000`) |
| `NEXT_PUBLIC_LOG_LEVEL` | *(optional)* client log level |
| `ABLY_API_KEY` | *(optional)* enable realtime |
| `EMAIL_FROM`, `EMAIL_SERVER_*` | *(optional)* enable email |
| `R2_*` | *(optional)* enable uploads |
| `PASSKEYS_ENABLED` | `true` to enable Passkeys UI/APIs |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` | WebAuthn relying party config |
| `MFA_TOTP_ENABLED` | `true` to enable TOTP APIs |
| `DEVICE_SESSION_MAX_AGE_DAYS` | Days to keep inactive device records (default 90) |
| `SECURITY_EMAIL_NOTIFICATIONS` | `true` to email on security events |

See **`.env.example`** for the full list.

---

## 7) Database & Migrations

- **ORM:** Prisma 7 with PostgreSQL.
- **Neon on Vercel:** Use **pooled** connection strings; TLS enabled; avoid long transactions.
- **Migrations:** Run in Node.js contexts (local/CI/server), **not** on Edge.
- **Seeds:** Idempotent; prefer `upsert`; use `SEED_MODE=dev|demo|test` as needed.

Commands:
```bash
npm run db:generate
npm run db:migrate
npm run db:reset
```

---

## 9) Deployment (Vercel)

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add **environment variables** in Project Settings (match `.env.example`).  
   - **Prisma:** ensure any code path that imports Prisma runs on the **Node.js** runtime (not Edge).
   - **Database:** Neon pooled connection string (SSL).

> For routes using Node‑only libs (Prisma, Nodemailer, AWS SDK), add:
> ```ts
> export const runtime = 'nodejs';
> ```

---

## 11) Contributing

We welcome contributions! Please read:

- **[AGENTS.md](./AGENTS.md)** — source‑of‑truth engineering guide
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)**
- **[SECURITY.md](./SECURITY.md)**
- **[LICENSE](./LICENSE)**
- **[CHANGELOG.md](./CHANGELOG.md)**
- **ADRs:** `docs/adr/` (start from `docs/adr-template.md`; see `docs/adr/0001-initial-architecture.md`)

Open an issue or PR with context, screenshots (if UI), and a rollback plan for risky changes.

---

## 13) Support

- Issues: GitHub Issues for bug reports and feature requests
- Security disclosures: see **SECURITY.md**
- Commercial inquiries or partnership: _email here_

---

## Roadmap

- Improve dashboard UX
- Add onboarding/profile completeness prompts
- Add a “facts graph” section in profiles (subject/predicate/object visualization)
- Expand identity providers (X, Discourse, Reddit, Telegram, etc.)
- Quests + XP feeding into Love/Reach
- Intuition Protocol minting for attestations

---

## Credits / Inspiration

This project is inspired by the [**Orbit Model**](https://github.com/orbit-love/orbit-model). Huge thank you and credit to the original authors for the orbit metaphor and visual language.
