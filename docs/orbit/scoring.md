# Scoring: Love, Reach, Gravity, and Orbit Levels

> How Atlas measures community engagement, influence, and assigns orbit levels.

`src/lib/scoring.ts`

---

## The Orbit Model

Atlas uses a scoring system inspired by the [Orbit Model](https://github.com/orbit-love/orbit-model), an open framework for measuring community engagement. The model defines three metrics:

- **Love** -- how deeply engaged a member is with the community
- **Reach** -- how much influence and connectedness a member has
- **Gravity** -- love multiplied by reach; the single number that determines orbit level

These three metrics feed into four **orbit levels** (innermost to outermost):

| Level | Meaning |
|-------|---------|
| **Advocate** (Orbit 1) | Core members. High engagement, high influence, recently active. |
| **Contributor** (Orbit 2) | Regular participants. Solid engagement with moderate reach. |
| **Participant** (Orbit 3) | Occasional engagers. Some gravity, may or may not be recently active. |
| **Explorer** (Orbit 4) | New or inactive members. Low gravity or haven't engaged yet. |

Members closer to the center (lower orbit number) are more engaged. The orbit visualization literally renders this -- advocates orbit closest to the center avatar, explorers on the outermost ring.

---

## Love (0--15 points)

Love measures **engagement depth** -- how much effort a member puts into the community. It answers: "Does this person care?"

### Components

Love is the sum of three components:

#### 1. Profile Bonus (0--3 points)

How complete is the member's profile? We check five fields:

| Field | Truthy when |
|-------|-------------|
| `headline` | Non-null, non-empty string |
| `bio` | Non-null, non-empty string |
| `links` | Array with at least one item |
| `skills` | Array with at least one item |
| `tags` | Array with at least one item |

The bonus is `Math.floor(fieldCount * 3 / 5)`:

| Fields filled | Bonus |
|---------------|-------|
| 0 | 0 |
| 1 | 0 |
| 2 | 1 |
| 3 | 1 |
| 4 | 2 |
| 5 | 3 |

**Why this formula?** A simple threshold (e.g., "3 or more = bonus") creates a cliff. The floor-based formula rewards incremental effort -- filling one more field always helps (eventually). But it also avoids giving full marks for just dropping in a headline and a bio. You need to genuinely fill out your profile to max it.

#### 2. Approved Bonus (+2 points)

If the member's status is `APPROVED`, they get +2 points. This rewards going through the community's approval process (applying, being vetted, getting accepted). Pending or rejected members don't receive this.

**Why?** Approval represents a baseline commitment. The member chose to apply, and the community chose to accept them. That mutual selection is a signal of engagement intent.

#### 3. Activity Score (0--10 points)

This is the heart of the love calculation. It uses **exponential time decay** to measure recent attestation activity within the community.

Every attestation a member gives to another community peer contributes to their activity score, but recent attestations count far more than old ones. The formula for each attestation:

```
contribution = exp(-ln(2) * daysSinceAttestation / halfLifeDays)
```

With the default half-life of 30 days:

| Days ago | Contribution |
|----------|--------------|
| Today | 1.00 |
| 7 days | 0.84 |
| 15 days | 0.71 |
| 30 days | 0.50 |
| 60 days | 0.25 |
| 90 days | 0.13 |

The sum of all contributions is capped at `activityScoreCap` (default: 10) and rounded to the nearest integer.

**Why exponential decay?** Three reasons:

1. **Recency matters.** A member who gave 10 attestations 6 months ago and hasn't been seen since is not "loving" the community. They were, past tense. The decay naturally captures this -- their contributions asymptotically approach zero.

2. **Sustained activity is rewarded.** A member who gives one attestation per week for 10 weeks scores higher than someone who gave 10 attestations in one day 30 days ago. The steady contributor has more recent activity, so each contribution has a higher decay weight.

3. **No cliff edges.** Binary cutoffs ("active in the last 30 days? yes/no") create sudden jumps. Decay is smooth. A member who was active 31 days ago doesn't suddenly drop to zero -- they gradually fade, giving them (and community managers) time to re-engage.

**Why cap at 10?** Without a cap, a hyperactive member who gives hundreds of attestations in a day could dominate the love score. The cap ensures that love maxes out at a reasonable level of sustained engagement, not spam volume.

**Why only attestations given, not received?** Love is about *your* effort, not your popularity. Giving attestations is a deliberate action -- you sought out a peer, evaluated them, and vouched for them. Receiving attestations is passive. Reach (below) captures the receiving side.

### Activity Window

Only attestations within the `activityWindowDays` (default: 90 days) are considered. Attestations older than 90 days are completely ignored -- not even their decayed contribution is included. This prevents the query from loading years of historical data for a single score computation.

### Community Scoping

This is critical: **only attestations between members of the same community count.** If Alice is in Community A and Community B, and she attests Bob (who is only in Community B), that attestation contributes to her love score in Community B, but not in Community A. Love is community-specific engagement.

### Total Love Range

| Component | Min | Max |
|-----------|-----|-----|
| Profile | 0 | 3 |
| Approved | 0 | 2 |
| Activity | 0 | 10 |
| **Total** | **0** | **15** |

---

## Reach (0--90 points)

Reach measures **influence and connectedness** -- how broadly a member's impact extends. It answers: "How many people does this person affect?"

### Components

Reach is the weighted sum of five dimensions:

#### 1. Unique Peers Attested (max 20, weight x1 = 0--20 points)

How many distinct community members have you given attestations to? This measures the **breadth** of your outbound engagement. Attesting 15 different people is more impressive than attesting the same person 15 times.

#### 2. Unique Peers Who Attested You (max 20, weight x2 = 0--40 points)

How many distinct community members have attested *you*? This is the strongest reach signal -- it means multiple independent people chose to vouch for you. The x2 weight reflects that being recognized by peers is harder to manufacture than giving attestations yourself.

**Why is received weighted 2x higher than given?** Anyone can give attestations. But receiving them requires earning the community's trust. A member who is attested by 10 different peers is demonstrably more influential than one who attested 10 peers themselves. Received attestations are a stronger quality signal.

#### 3. Extra Attestations Given (max 10, weight x1 = 0--10 points)

Total attestations given minus unique peers given to. This captures **depth of repeated engagement** -- attesting the same person multiple times (e.g., different attestation types like "skills", "collaboration", "mentorship") shows deeper relationships. Capped at 10 to prevent spam from dominating.

#### 4. Extra Attestations Received (max 10, weight x1 = 0--10 points)

Same logic for received. Multiple attestations from the same person (across different types) indicate a deeper relationship.

#### 5. External Community Count (max 5, weight x2 = 0--10 points)

How many **other** communities is this member an approved member of? This is the **external dimension** -- a member who is active in 3 other communities brings cross-community knowledge, connections, and credibility. The x2 weight reflects the value of bridging communities.

**Why only 5 max?** Diminishing returns. Being in 2-3 other communities is meaningfully different from being in zero. But being in 20 vs 15 doesn't add proportionally more value. The cap prevents "community collecting" from dominating reach.

### Community Scoping (again)

Like love, reach attestation counts are **community-scoped**. Both the attester and the attestee must be approved members of the same community. Alice attesting Bob only counts toward reach in communities where both Alice and Bob are approved members.

The external community count is the one exception -- it explicitly looks at *other* communities.

### Total Reach Range

| Dimension | Max raw | Weight | Max points |
|-----------|---------|--------|------------|
| Unique given | 20 | x1 | 20 |
| Unique received | 20 | x2 | 40 |
| Extra given | 10 | x1 | 10 |
| Extra received | 10 | x1 | 10 |
| External communities | 5 | x2 | 10 |
| **Total** | | | **90** |

---

## Gravity

Gravity is simply:

```
gravity = love * reach
```

**Why multiplication, not addition?** Multiplication makes both factors necessary. A member with high love (15) but zero reach gets gravity = 0. A member with high reach (90) but zero love also gets gravity = 0. You need both engagement depth and influence breadth to achieve a high gravity score.

This prevents two failure modes:

1. **The ghost influencer:** Someone who was once well-connected but hasn't engaged in months. Their reach stays high (attestations don't expire for reach), but their love decays to near-zero, dragging gravity down.

2. **The invisible enthusiast:** Someone who is highly engaged (complete profile, recently active) but hasn't connected with anyone. Their love is high, but reach is zero. Gravity is zero until they start building relationships.

### Gravity Range

- **Minimum:** 0 (either love or reach is zero)
- **Maximum:** 15 * 90 = 1,350 (theoretical; practically unachievable)
- **Realistic high:** A very active member might have love ~12, reach ~60, giving gravity ~720

---

## Orbit Levels

Orbit levels are assigned based on **absolute gravity thresholds** combined with **behavioral gates** (recency of attestation activity).

### Default Thresholds

| Level | Min Gravity | Recent Attestation Requirement |
|-------|-------------|-------------------------------|
| **Advocate** | 200 | Must have attested a community peer within the last 30 days |
| **Contributor** | 50 | Must have attested a community peer within the last 60 days |
| **Participant** | 10 | No recency requirement |
| **Explorer** | 0 | Default for everyone else |

### How Assignment Works

Levels are evaluated **top-down**. For each member:

1. Check ADVOCATE: gravity >= 200 AND last attestation to a community peer within 30 days? If yes, assign ADVOCATE. Done.
2. Check CONTRIBUTOR: gravity >= 50 AND last attestation within 60 days? If yes, assign CONTRIBUTOR. Done.
3. Check PARTICIPANT: gravity >= 10? If yes, assign PARTICIPANT. Done.
4. Otherwise: assign EXPLORER.

First match wins. A member who qualifies for ADVOCATE won't also be checked for CONTRIBUTOR.

### Why Thresholds Instead of Percentiles?

The previous system used percentile-based bucketing (top 10% = advocate, next 20% = contributor, etc.). This had several problems:

1. **Relative, not absolute.** In a 3-person community, the top 10% is less than one person. Everyone gets pushed down. In a 10,000-person community, the top 10% is 1,000 advocates, which dilutes the meaning.

2. **Zero-sum.** One member moving up means another moves down, even if both are equally engaged. Percentiles pit members against each other.

3. **Sensitive to inactive members.** A community with 1,000 members but only 50 active ones would give advocate status to 100 members (top 10% of 1,000), most of whom are inactive. Percentiles can't distinguish activity from presence.

Absolute thresholds solve all three problems. A community of 3 can have zero advocates if nobody hits gravity 200. A community of 10,000 can have 500 advocates if 500 members earn it. Members are measured against the bar, not against each other.

### Behavioral Gates (Recency)

Thresholds alone aren't enough. A member who had gravity 300 six months ago but hasn't been seen since shouldn't remain an advocate. That's where the recency gate comes in.

The recency gate checks: "When was the last time this member gave an attestation to a community peer?" If it's beyond the threshold (30 days for advocates, 60 days for contributors), they don't qualify, regardless of their gravity score.

This creates **natural demotion**:

- An advocate who stops engaging will fall to contributor after 30 days, then to participant after 60 days, then to explorer as their gravity decays below 10.
- No manual intervention needed. The system self-corrects.

Participant has no recency gate (`null`). Once you hit gravity 10, you stay a participant until your gravity drops below 10 (which happens naturally as love decays). This is intentional -- participant is the "you've been here and done something" level, and we don't penalize occasional contributors for taking breaks.

### Orbit Level Override

Admins can manually set a member's orbit level via the `orbitLevelOverride` field on the `Membership` model. When set, the automated gravity-based assignment is skipped entirely for that member — the override becomes the effective `orbitLevel`.

#### Who Can Override

Only **Owners** and **Admins** with an `APPROVED` membership status can set orbit overrides. The permission is checked server-side in `POST /api/membership/orbit`. Moderators and regular members cannot perform overrides.

#### Owner Lock

Owners are always locked to **Advocate** (Orbit 1). Their orbit level cannot be changed — not even by another owner. The API returns `403 FORBIDDEN` with `"Owner orbit level cannot be changed"` if attempted. In the UI, owners don't see the admin menu on their own card, and other admins don't see it on the owner's card either.

#### How It Works

1. Admin opens the member's context menu (⋮) in the community directory
2. Under "Orbit level", they choose from: **Auto**, **Explorer**, **Participant**, **Contributor**, or **Advocate**
3. The UI optimistically updates the member card immediately
4. A fire-and-forget `POST /api/membership/orbit` request persists the change

The API does three things atomically (inside a transaction):

1. Sets `orbitLevelOverride` to the chosen level (or `null` for "Auto")
2. Syncs `orbitLevel` to match the override, so all consumers see the effective level immediately
3. Creates a `ScoringEvent` record (type `ORBIT_OVERRIDE`) for audit

After the transaction, a best-effort `recomputeOrbitLevelsForCommunity()` runs to recalculate other members' levels.

#### Interaction with Automated Scoring

When `recomputeOrbitLevelsForCommunity()` runs (daily cron or after override), it **skips** two categories of members:

- Members with `orbitLevelOverride` set (manual control)
- Members with `OWNER` role (always Advocate)

Only members without overrides get recalculated based on gravity thresholds and recency gates. This means an override is sticky — it persists across cron runs until an admin explicitly sets it back to "Auto" (`null`).

#### Clearing an Override

Setting the override to "Auto" in the menu sends `orbitLevelOverride: null` to the API. This removes the override and allows the next scoring run to assign the level automatically based on the member's gravity and recency. The `orbitLevel` field is **not** immediately recalculated on clear — it retains the previous override value until the next cron run or a manual recompute.

#### UI Indicators

Overridden members are visually distinct in the directory:

- **Override badge**: Red/destructive-tinted badge with a lock icon and the level name (e.g., 🔒 Advocate)
- **Tooltip**: "Manually set by admin" (or "Owner — always Advocate" for owners)
- **Auto badge**: Standard secondary badge with just the level name (no lock)

#### Filtering

The member list API (`GET /api/membership/list`) supports an `orbitLevelType` query param:

| Value | Behavior |
|-------|----------|
| `any` | All members (default) |
| `auto` | Only members where `orbitLevelOverride` is `null` |
| `manual` | Only members where `orbitLevelOverride` is set |

This allows admins to quickly see which members have manual overrides.

#### Use Cases

- Founders/organizers who should always be advocates regardless of attestation patterns
- Members who contribute in ways the scoring system doesn't capture (e.g., hosting events, providing infrastructure)
- Temporary promotions for recognition
- Correcting edge cases where the automated scoring doesn't reflect reality

#### Audit Trail

Every override change is logged in the `ScoringEvent` table:

| Field | Value |
|-------|-------|
| `type` | `ORBIT_OVERRIDE` |
| `communityId` | The community where the override was applied |
| `actorId` | The admin who performed the override |
| `metadata.subjectUserId` | The member whose level was changed |
| `metadata.orbitLevelOverride` | The new override value (or `null` if cleared) |

---

## Configuration

Every community can customize scoring behavior via the `Community.orbitConfig` JSON field. The schema is defined by `OrbitConfigSchema` in `src/lib/scoring.ts`.

### Configurable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `thresholds.ADVOCATE.minGravity` | 200 | Minimum gravity for advocate level |
| `thresholds.ADVOCATE.recentAttestationDays` | 30 | Max days since last attestation to qualify |
| `thresholds.CONTRIBUTOR.minGravity` | 50 | Minimum gravity for contributor level |
| `thresholds.CONTRIBUTOR.recentAttestationDays` | 60 | Max days since last attestation to qualify |
| `thresholds.PARTICIPANT.minGravity` | 10 | Minimum gravity for participant level |
| `thresholds.PARTICIPANT.recentAttestationDays` | null | No recency requirement |
| `decayHalfLifeDays` | 30 | Half-life for exponential decay on love activity |
| `activityWindowDays` | 90 | Only attestations within this window count for love |
| `activityScoreCap` | 10 | Max activity score from decay sum |

If `orbitConfig` is null, malformed, or fails schema validation, the system silently falls back to `DEFAULT_ORBIT_CONFIG`. This means every community works out of the box with zero configuration.

Config changes are tracked in `CommunityConfigRevision` (type `ORBIT`) for audit purposes. This allows community managers to experiment with thresholds and roll back if needed.

### What's Not Configurable (Yet)

The reach weights and caps are hardcoded in the `REACH` constant. Making them configurable would allow communities to emphasize different dimensions (e.g., a mentorship community might weight received attestations even higher). See Future Improvements below.

---

## When Scores Update

Scores are recomputed in three contexts:

### 1. On Membership Events (Immediate)

When a member's status changes (join, approval, rejection), `recomputeMemberScores()` is called for that single member. This happens in:

- `POST /api/membership/submit` -- after a user applies to join
- `POST /api/membership/review` -- after a member is approved/rejected

### 2. Daily Cron Job (Batch)

`GET /api/cron/recompute-scores` runs daily at 3:00 AM UTC (configured in `vercel.json`). It:

1. Finds every community with at least one approved member
2. For each community, fetches all approved member IDs
3. Calls `recomputeMemberScoresBatch()` for all members at once
4. Calls `recomputeOrbitLevelsForCommunity()` to reassign levels

This is the primary mechanism for keeping scores fresh. Because love uses time decay, scores change even when no new attestations are given -- a member's activity score naturally decreases as their attestations age. The daily cron ensures these decays are reflected in the database.

The cron route uses Bearer token auth (`CRON_SECRET`), not session auth. It defaults to dry-run mode outside production (`?dryRun=true`).

### 3. ScoringEvent Logging (Audit Only)

When an attestation is created or retracted, a `ScoringEvent` is logged for every community where both the attester and attestee are approved members. These events are **fire-and-forget** -- they don't trigger score recomputation. They exist for observability and future use (e.g., real-time score updates, analytics dashboards).

The logging function (`logScoringEvent`) runs as an unresolved promise with a `.catch(() => {})` handler. If it fails, the attestation operation still succeeds. Scoring events are never allowed to block or break the critical path.

---

## Database Schema

### Membership (scores live here)

| Field | Type | Description |
|-------|------|-------------|
| `loveScore` | `Int @default(0)` | Computed love score |
| `reachScore` | `Int @default(0)` | Computed reach score |
| `gravityScore` | `Int @default(0)` | love * reach |
| `orbitLevel` | `OrbitLevel @default(EXPLORER)` | Effective orbit level (auto-computed or synced from override) |
| `orbitLevelOverride` | `OrbitLevel?` | Admin-set override; when non-null, `orbitLevel` mirrors this and auto-assignment is skipped |
| `lastActiveAt` | `DateTime?` | Reserved for future use |

### ScoringEvent (audit trail)

| Field | Type | Description |
|-------|------|-------------|
| `communityId` | `String` | Which community this event is scoped to |
| `actorId` | `String` | Who performed the action |
| `subjectUserId` | `String?` | Who was affected (e.g., the attestee) |
| `type` | `ScoringType` | Event type (ATTESTED, ATTESTATION_RETRACTED, etc.) |
| `metadata` | `Json?` | Arbitrary context data |

### ScoringType Enum

| Value | When logged |
|-------|-------------|
| `ATTESTED` | Member gives an attestation to a community peer |
| `ATTESTATION_RETRACTED` | Member revokes an attestation |
| `ATTESTATION_SUPERSEDED` | Attestation replaced by a new one (different confidence) |
| `PROFILE_UPDATED` | Member updates their profile |
| `COMMUNITY_UPDATED` | Community settings changed |
| `ROLE_UPDATED` | Member's role changed |
| `ORBIT_OVERRIDE` | Manual orbit level override applied (actively logged) |
| `COMMUNITY_CREATED` | Community was created |
| `JOINED` | Member joined the community |

Currently `ATTESTED`, `ATTESTATION_RETRACTED`, and `ORBIT_OVERRIDE` are actively logged. The other types are defined in the schema for future use.

---

## Batch Recomputation Internals

`recomputeMemberScoresBatch()` is designed for efficiency with large communities. Here's how it works:

### Query Strategy

Instead of N+1 queries (one per member), it uses **5 parallel queries** in a single `Promise.all`:

1. **User profiles** -- `findMany` with selected fields (headline, bio, links, skills, tags)
2. **Membership statuses** -- to determine approved bonus
3. **Given attestations** -- all active attestations from target users to approved community members (returns fromUserId, toUserId, createdAt)
4. **Received attestations** -- all active attestations to target users from approved community members
5. **External community counts** -- `groupBy` to count approved memberships in other communities

### Aggregation

After the queries return, a single-pass iteration over the attestation rows builds:

- `givenDatesByUser` -- dates of attestations within the activity window (for love's decay sum)
- `givenUniquePeersByUser` -- `Set<string>` of unique peers attested (for reach)
- `givenTotalByUser` -- total attestations given (extra = total - unique)
- `receivedUniquePeersByUser` -- `Set<string>` of unique peers who attested this user
- `receivedTotalByUser` -- total attestations received

This avoids additional database round-trips for distinct counts.

### Write Strategy

Updates are batched in chunks of 50 and wrapped in `$transaction` to avoid overwhelming the database with a single massive transaction. This is especially important for serverless environments where connection pool sizes are limited.

---

## Future Improvements

### 1. Real-Time Score Updates on Attestation

Currently, scores only update on the daily cron. When a member gives an attestation, scores don't reflect the change until the next cron run. Adding `recomputeMemberScores()` calls in the attestation create/retract routes would provide instant feedback. The tradeoff is latency -- score recomputation adds ~50-200ms to the attestation response. A better approach might be optimistic client-side updates combined with the fire-and-forget server recompute.

### 2. Configurable Reach Weights

The `REACH` constant (weights, caps) is hardcoded. Moving these into `OrbitConfig` would let community managers tune the balance between given/received attestations, the value of external communities, and the caps. The schema is designed to make this straightforward -- just add the fields to `OrbitConfigSchema` and thread them through `computeReach()`.

### 3. Attestation Type Weights

Not all attestations are equal. A "mentorship" attestation probably represents deeper engagement than a "met at event" attestation. The scoring system currently treats all types identically. Adding per-type weights (stored in `orbitConfig`) would let communities define which attestation types matter most for love and reach.

### 4. Event-Sourced Score Computation

The `ScoringEvent` table already captures all attestation events. Instead of querying the `Attestation` table directly, scores could be computed from the event stream. This would enable:

- **Score history** -- plot a member's gravity over time
- **What-if analysis** -- "if we change the decay half-life, how would scores change?"
- **Faster recomputation** -- only process events since the last computation, not the full attestation table

### 5. `lastActiveAt` Tracking

The `Membership` model has a `lastActiveAt` field that isn't populated yet. Updating it when a member gives an attestation, updates their profile, or logs in would provide an additional activity signal. This could replace or supplement the attestation-based activity window for love.

### 6. Received Attestation Decay for Love

Currently, only attestations the member *gives* count toward the activity score in love. Adding decayed received attestations would mean that being recently attested by peers also signals engagement -- "the community is actively recognizing this person." This would need careful weighting to avoid double-counting with reach.

### 7. Community-Specific Attestation Type Configuration

Communities could define their own attestation types with custom weights, replacing the global `ATTESTATION_TYPES` constant. A mentorship community might have high-weight "mentored" and "was mentored by" types, while a developer community might emphasize "collaborated on code" and "reviewed PR."

### 8. Gravity Decay Curve Visualization

Exposing the decay math to the UI would let members see *why* their score is what it is. A small chart showing their activity contributions over the last 90 days, with the decay curve overlaid, would make the scoring system transparent and encourage engagement.

### 9. Incremental Batch Recomputation

The current cron recomputes all members in all communities every run. For large deployments, this could be optimized to only recompute members whose scores might have changed -- those who gave/received attestations since the last run, or whose activity window boundary crossed an attestation date. The `ScoringEvent` table provides exactly the data needed for this optimization.

### 10. Webhook/Notification on Level Change

When a member's orbit level changes (up or down), fire a webhook or send a notification. This enables integrations like Discord role assignment, email congratulations, or analytics tracking.
