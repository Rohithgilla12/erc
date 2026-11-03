# Strava Sync (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Strava OAuth 2.0 synchronization (Slice 6) for ERC, enabling members to securely connect Strava, import their runs from the past 90 days, sync real-time runs via webhooks and on-demand server actions, and enforce a 10-athlete pilot cap with waitlist and strict privacy isolation.

**Architecture:** Next.js Route Handlers for OAuth and Webhooks; Postgres `strava_connections` table storing tokens encrypted at rest with AES-256-GCM; `@erc/domain` pure functions for activity parsing and IST date conversion; Next.js Server Actions on `/me` for progressive enhancement with zero external background daemons.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Payload CMS / Postgres (via Drizzle ORM), Node.js `node:crypto` (AES-256-GCM, scrypt), `@erc/domain`, `@erc/contract`, Vitest.

## Global Constraints
- Zero added hosting costs: Runs completely within the existing Next.js web application container; no separate background daemon or worker processes.
- Progressive enhancement: All form interactions (`syncStravaAction`, `disconnectStravaAction`, `joinStravaWaitlistAction`) function as native HTML `<form action={...}>` without requiring JavaScript.
- Strict privacy invariant: Strava activities are tagged with `source = 'strava'` and are excluded from `PUBLIC_SOURCES`. They never appear on public leaderboards or coach views, honoring the Strava Developer Agreement (effective 2026-06-01).
- Immediate revocation: Disconnecting or deauthorizing immediately and permanently purges all tokens and Strava-sourced activity rows for that member.
- Rate limiting & cap: Capped at `STRAVA_ATHLETE_CAP` (default 10) connected athletes with an automated waitlist.

---

### Task 1: Domain Parsers & Strava Activity Mapping (`@erc/domain`)

**Files:**
- Modify: `packages/domain/src/activities.ts`
- Modify: `packages/domain/src/activities.test.ts`
- Export from: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `export type StravaRunPayload = { id: number | string; name?: string; distance: number; moving_time: number; start_date_local: string; type?: string; sport_type?: string }`
  - `export function parseStravaRun(raw: StravaRunPayload): Result<StoredActivity<'strava'>, 'not_a_run' | 'invalid_distance' | 'invalid_pace' | 'invalid_date'>`
  - `export function isRunActivity(type?: string, sportType?: string): boolean`

- [ ] **Step 1: Write failing tests for Strava run parsing in `activities.test.ts`**

Add tests covering:
- Rejecting non-run activities (e.g. `Ride`, `Swim`).
- Successfully parsing a valid run (mapping distance, seconds, IST date, and ref `strava:<id>`).
- Rejecting runs with pace faster than 2:30 min/km or distance > 250 km.
- Rejecting runs with invalid dates.

```ts
// packages/domain/src/activities.test.ts
describe('parseStravaRun', () => {
  it('parses a valid Strava run into a StoredActivity<"strava">', () => {
    const raw = {
      id: 123456789,
      name: 'Morning Easy Run',
      distance: 10000, // metres
      moving_time: 3000, // seconds -> 5:00/km pace
      start_date_local: '2026-11-03T07:00:00Z',
      type: 'Run',
    }
    const parsed = parseStravaRun(raw, 1 as MemberId)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.source).toBe('strava')
    expect(parsed.value.ref).toBe('strava:123456789')
    expect(parsed.value.distance).toBe(10000)
    expect(parsed.value.moving).toBe(3000)
    expect(parsed.value.on).toBe('2026-11-03')
    expect(parsed.value.note).toBe('Morning Easy Run')
  })

  it('rejects non-run activities', () => {
    const ride = { id: 2, distance: 20000, moving_time: 3600, start_date_local: '2026-11-03T07:00:00Z', type: 'Ride' }
    expect(parseStravaRun(ride, 1 as MemberId).ok).toBe(false)
  })

  it('rejects implausible pace faster than 2:30/km', () => {
    const sprint = { id: 3, distance: 1000, moving_time: 100, start_date_local: '2026-11-03T07:00:00Z', type: 'Run' }
    const parsed = parseStravaRun(sprint, 1 as MemberId)
    expect(parsed.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @erc/domain test`
Expected: FAIL (cannot find name `parseStravaRun`)

- [ ] **Step 3: Implement `parseStravaRun` in `packages/domain/src/activities.ts`**

```ts
export type StravaRunPayload = {
  id: number | string
  name?: string
  distance: number
  moving_time: number
  start_date_local: string
  type?: string
  sport_type?: string
}

export const isRunActivity = (type?: string, sportType?: string): boolean => {
  const t = (sportType ?? type ?? '').toLowerCase()
  return t === 'run' || t === 'trailrun' || t === 'virtualrun'
}

export const parseStravaRun = (
  raw: StravaRunPayload,
  member: MemberId,
): Result<StoredActivity<'strava'>, 'not_a_run' | 'invalid_distance' | 'invalid_pace' | 'invalid_date'> => {
  if (!isRunActivity(raw.type, raw.sport_type)) return err('not_a_run')
  const distance = Math.round(raw.distance) as Metres
  if (distance <= 0 || distance > MAX_RUN_METRES) return err('invalid_distance')
  const moving = Math.round(raw.moving_time) as Seconds
  if (moving <= 0) return err('invalid_pace')
  if (moving / (distance / 1000) < MIN_SECONDS_PER_KM) return err('invalid_pace')

  // Parse YYYY-MM-DD from start_date_local (assumed to be in local athletic time)
  const dateStr = raw.start_date_local.slice(0, 10)
  const on = dateStr as LocalDate
  if (on < EARLIEST_RUN_DATE) return err('invalid_date')

  const ref = `strava:${raw.id}` as SourceRef
  const note = raw.name ? raw.name.slice(0, 280) : null

  return ok({
    member,
    source: 'strava',
    ref,
    on,
    distance,
    moving,
    loggedAt: instantOf(new Date().toISOString()),
    ...(note ? { note } : {}),
  })
}
```

- [ ] **Step 4: Run domain tests to verify they pass**

Run: `pnpm --filter @erc/domain test`
Expected: PASS (all 20 files green)

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/domain/src/activities.ts packages/domain/src/activities.test.ts packages/domain/src/index.ts
git commit -m "Add Strava run parser and validation in @erc/domain"
```

---

### Task 2: Contract Operations & Wire Types (`@erc/contract`)

**Files:**
- Modify: `packages/contract/src/index.ts`
- Modify: `packages/contract/src/index.test.ts`

**Interfaces:**
- Consumes: `@erc/domain` types.
- Produces: 4 new operations in `OPERATIONS`:
  - `stravaStatus`: `GET /me/strava` (access: `member`)
  - `syncStrava`: `POST /me/strava/sync` (access: `member`)
  - `disconnectStrava`: `POST /me/strava/disconnect` (access: `member`)
  - `joinStravaWaitlist`: `POST /me/strava/waitlist` (access: `member`)
  - Types: `StravaStatusView`, `StravaSyncResultView`, `StravaDisconnectView`, `StravaWaitlistView`.

- [ ] **Step 1: Write failing contract tests for Strava operations in `index.test.ts`**

Add tests verifying:
- Operation paths and methods map to member access tier.
- Output shapes conform to expected views.

```ts
// packages/contract/src/index.test.ts
it('restricts Strava operations to member access tier', () => {
  expect(OPERATIONS.stravaStatus.access).toBe('member')
  expect(OPERATIONS.syncStrava.access).toBe('member')
  expect(OPERATIONS.disconnectStrava.access).toBe('member')
  expect(OPERATIONS.joinStravaWaitlist.access).toBe('member')
})
```

- [ ] **Step 2: Run contract tests to verify failure**

Run: `pnpm --filter @erc/contract test`
Expected: FAIL (OPERATIONS.stravaStatus undefined)

- [ ] **Step 3: Define wire types and operations in `packages/contract/src/index.ts`**

```ts
export type StravaConnectionState = 'connected' | 'waitlisted' | 'disconnected'

export type StravaStatusView = {
  enabled: boolean
  status: StravaConnectionState
  athleteId: number | null
  lastSyncedAt: string | null
  connectedCount: number
  cap: number
  isAtCap: boolean
  waitlistPosition: number | null
}

export type StravaSyncResultView = {
  synced: number
  lastSyncedAt: string
}

export type StravaDisconnectView = {
  disconnected: true
}

export type StravaWaitlistView = {
  waitlisted: true
  position: number
}

// In OPERATIONS:
stravaStatus: op({
  method: 'GET',
  path: '/me/strava',
  access: 'member',
  parse: noInput,
  fields: phantom<Record<string, never>>(),
  output: phantom<OwnerOnly<StravaStatusView>>(),
}),
syncStrava: op({
  method: 'POST',
  path: '/me/strava/sync',
  access: 'member',
  parse: noInput,
  fields: phantom<Record<string, never>>(),
  output: phantom<OwnerOnly<StravaSyncResultView>>(),
}),
disconnectStrava: op({
  method: 'POST',
  path: '/me/strava/disconnect',
  access: 'member',
  parse: noInput,
  fields: phantom<Record<string, never>>(),
  output: phantom<OwnerOnly<StravaDisconnectView>>(),
}),
joinStravaWaitlist: op({
  method: 'POST',
  path: '/me/strava/waitlist',
  access: 'member',
  parse: noInput,
  fields: phantom<Record<string, never>>(),
  output: phantom<OwnerOnly<StravaWaitlistView>>(),
}),
```

- [ ] **Step 4: Run contract tests to verify they pass**

Run: `pnpm --filter @erc/contract test`
Expected: PASS (all 29 tests green)

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/contract/src/index.ts packages/contract/src/index.test.ts
git commit -m "Add Strava operations and wire types to @erc/contract"
```

---

### Task 3: Database Migration & Token Encryption (`apps/web`)

**Files:**
- Create: `apps/web/src/members/strava-crypto.ts`
- Create: `apps/web/src/migrations/20261103_120000_strava.ts`
- Modify: `apps/web/src/migrations/index.ts`

**Interfaces:**
- Consumes: `PAYLOAD_SECRET` from environment.
- Produces:
  - `encryptToken(plainText: string): string`
  - `decryptToken(cipherText: string): string`
  - Postgres table `strava_connections`.

- [ ] **Step 1: Implement `strava-crypto.ts` with AES-256-GCM**

```ts
// apps/web/src/members/strava-crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT = 'erc-strava-encryption-salt'
const IV_LENGTH = 12

function getKey(): Buffer {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) throw new Error('PAYLOAD_SECRET is required for token encryption')
  return scryptSync(secret, SALT, 32)
}

export function encryptToken(text: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptToken(encryptedString: string): string {
  const parts = encryptedString.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted token format')
  const [ivHex, tagHex, contentHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const content = Buffer.from(contentHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(content), decipher.final()])
  return decrypted.toString('utf8')
}
```

- [ ] **Step 2: Create Migration `20261103_120000_strava.ts`**

```ts
// apps/web/src/migrations/20261103_120000_strava.ts
import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS strava_connections (
      member_id BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      athlete_id BIGINT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at TIMESTAMPTZ NOT NULL,
      scope TEXT NOT NULL DEFAULT 'read,activity:read',
      status TEXT NOT NULL DEFAULT 'connected',
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_strava_athlete_id ON strava_connections(athlete_id);
    CREATE INDEX IF NOT EXISTS idx_strava_status ON strava_connections(status);
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS strava_connections CASCADE;
  `)
}
```

- [ ] **Step 3: Register migration in `apps/web/src/migrations/index.ts`**

- [ ] **Step 4: Run migration against Postgres and verify rollback**

Run: `pnpm --filter @erc/web payload migrate`
Expected: Migration executed successfully.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/web/src/members/strava-crypto.ts apps/web/src/migrations/20261103_120000_strava.ts apps/web/src/migrations/index.ts
git commit -m "Add strava_connections table migration and AES-256-GCM token encryption"
```

---

### Task 4: Backend Strava Service & Dispatcher Integration (`apps/web/src/members`)

**Files:**
- Create: `apps/web/src/members/strava.ts`
- Modify: `apps/web/src/members/run.ts`

**Interfaces:**
- Consumes: `@erc/contract`, `@erc/domain`, `strava-crypto.ts`.
- Produces:
  - `getStravaStatus(payload, memberId): Promise<StravaStatusView>`
  - `getValidStravaToken(payload, memberId): Promise<string | null>`
  - `syncStravaActivities(payload, memberId, options?: { lookbackDays?: number }): Promise<Result<{ synced: number }, string>>`
  - `disconnectStrava(payload, memberId): Promise<void>`
  - `joinStravaWaitlist(payload, memberId): Promise<{ position: number }>`
  - Wires handlers in `IMPLEMENTATIONS` in `apps/web/src/members/run.ts`.

- [ ] **Step 1: Implement `apps/web/src/members/strava.ts`**

Key responsibilities:
- `getStravaStatus`: Checks `STRAVA_ENABLED` (returns `{ enabled: false, ... }` if unset/false). Counts total connected. Reads member's row. Calculates waitlist position if waitlisted.
- `getValidStravaToken`: Checks `token_expires_at`. If expiring within 5 minutes, calls `https://www.strava.com/oauth/token` with `grant_type: 'refresh_token'`. Saves encrypted tokens. Returns decrypted access token.
- `syncStravaActivities`: Calls Strava `GET /athlete/activities?after=...&per_page=200`. Parses runs with `parseStravaRun`. Upserts into `activities` with `source = 'strava'`.
- `disconnectStrava`: Calls `https://www.strava.com/oauth/deauthorize`. Runs transaction deleting `source = 'strava'` activities and `strava_connections` row.
- `joinStravaWaitlist`: Inserts `strava_connections` row with `status = 'waitlisted'`.

- [ ] **Step 2: Wire `IMPLEMENTATIONS` in `apps/web/src/members/run.ts`**

Map:
- `stravaStatus` -> `getStravaStatus`
- `syncStrava` -> `syncStravaActivities`
- `disconnectStrava` -> `disconnectStrava`
- `joinStravaWaitlist` -> `joinStravaWaitlist`

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm typecheck`
Expected: PASS (0 errors)

- [ ] **Step 4: Commit Task 4**

```bash
git add apps/web/src/members/strava.ts apps/web/src/members/run.ts
git commit -m "Implement backend Strava services and dispatch handlers in run.ts"
```

---

### Task 5: OAuth Connect & Callback Route Handlers (`apps/web/src/app/api/v1/strava`)

**Files:**
- Create: `apps/web/src/app/api/v1/strava/connect/route.ts`
- Create: `apps/web/src/app/api/v1/strava/callback/route.ts`

**Interfaces:**
- Consumes: `MemberSession`, `strava.ts`, `strava-crypto.ts`.
- Produces:
  - `GET /api/v1/strava/connect`: Redirects to Strava OAuth with HMAC CSRF state.
  - `GET /api/v1/strava/callback`: Validates state, exchanges auth code, verifies cap, triggers 90-day sync, redirects to `/me`.

- [ ] **Step 1: Implement `connect/route.ts`**

Verify member session from cookies. Generate state: `${memberId}.${hmacSignature}`. Redirect to:
`https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=read,activity:read&state=${state}`.

- [ ] **Step 2: Implement `callback/route.ts`**

- Check for `error === 'access_denied'`. Redirect to `/me?strava=denied`.
- Verify HMAC state parameter matches logged-in member.
- Count active connections against `STRAVA_ATHLETE_CAP` (default 10).
- If at cap: Record `status = 'waitlisted'`, redirect to `/me?strava=waitlisted`.
- If under cap: Call `https://www.strava.com/oauth/token`, save encrypted tokens (`status = 'connected'`), trigger `syncStravaActivities(payload, memberId, { lookbackDays: 90 })`, redirect to `/me?strava=connected`.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @erc/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit Task 5**

```bash
git add apps/web/src/app/api/v1/strava/connect/route.ts apps/web/src/app/api/v1/strava/callback/route.ts
git commit -m "Implement Strava OAuth connect and callback route handlers"
```

---

### Task 6: Webhook Subscription Handshake & Event Ingestion (`apps/web/src/app/api/v1/strava/webhook`)

**Files:**
- Create: `apps/web/src/app/api/v1/strava/webhook/route.ts`

**Interfaces:**
- Consumes: `STRAVA_WEBHOOK_VERIFY_TOKEN`, `strava.ts`.
- Produces:
  - `GET /api/v1/strava/webhook`: Strava subscription challenge validation.
  - `POST /api/v1/strava/webhook`: Real-time event handling (`activity.create`, `activity.delete`, `athlete.deauthorize`).

- [ ] **Step 1: Implement `GET` challenge handshake**

Validate `hub.mode === 'subscribe'` and `hub.verify_token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN`. Echo `hub.challenge`.

- [ ] **Step 2: Implement `POST` event handler**

- `object_type === 'activity'` & `aspect_type === 'create'`: Find member by `athlete_id = owner_id`. Fetch activity from Strava. If Run, upsert into `activities`.
- `object_type === 'activity'` & `aspect_type === 'delete'`: Find member by `athlete_id = owner_id`. Delete `ref = 'strava:${object_id}'` from `activities`.
- `object_type === 'athlete'` & `updates.authorized === 'false'`: Purge connection and activities for this athlete.

- [ ] **Step 3: Verify route compilation**

Run: `pnpm --filter @erc/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit Task 6**

```bash
git add apps/web/src/app/api/v1/strava/webhook/route.ts
git commit -m "Implement Strava webhook subscription handshake and event dispatcher"
```

---

### Task 7: Athlete UI & Server Actions on `/me` (`apps/web`)

**Files:**
- Modify: `apps/web/src/app/(frontend)/me/actions.ts`
- Modify: `apps/web/src/app/(frontend)/me/page.tsx`
- Modify: `apps/web/src/app/(frontend)/me/members.css`

**Interfaces:**
- Consumes: `run()` operations `stravaStatus`, `syncStrava`, `disconnectStrava`, `joinStravaWaitlist`.
- Produces:
  - Server actions: `syncStravaAction`, `disconnectStravaAction`, `joinStravaWaitlistAction`.
  - Responsive Strava Sync Card in athlete dashboard.

- [ ] **Step 1: Add server actions in `actions.ts`**

Implement `syncStravaAction`, `disconnectStravaAction`, and `joinStravaWaitlistAction` calling `run()` with revalidation of `/me`.

- [ ] **Step 2: Render Strava card on `/me/page.tsx`**

- If `!strava.enabled`: Render nothing.
- If `status === 'disconnected'`:
  - If under cap: Primary orange "Connect with Strava" button linking to `/api/v1/strava/connect`.
  - If at cap: "Strava Pilot Full (10/10)" banner with "Join Waitlist" form button.
- If `status === 'waitlisted'`:
  - "You are on the Strava waitlist (Position #X)" banner.
- If `status === 'connected'`:
  - Connected badge with athlete ID.
  - "Last synced: [timestamp]".
  - Form button: `[Sync Now]`.
  - Form button: `[Disconnect Strava]`.

- [ ] **Step 3: Add CSS styling in `members.css`**

Add styles for `.strava-card`, `.btn-strava`, `.strava-badge`, `.strava-meta`.

- [ ] **Step 4: Verify typecheck and build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit Task 7**

```bash
git add apps/web/src/app/(frontend)/me/actions.ts apps/web/src/app/(frontend)/me/page.tsx apps/web/src/app/(frontend)/me/members.css
git commit -m "Add Strava UI card, status display, and server actions to member dashboard"
```

---

### Task 8: End-to-End Verification Script & Documentation

**Files:**
- Create: `apps/web/src/scripts/check-strava.ts`
- Modify: `README.md`
- Modify: `todo.md`
- Modify: `decisions.tsv`

**Interfaces:**
- Consumes: Complete Strava integration on live local database.
- Produces: Automated verification script with assertions proving:
  1. OAuth state token signing and verification.
  2. Token encryption at rest (AES-256-GCM verification in Postgres).
  3. 10-athlete cap enforcement & waitlist assignment.
  4. 90-day sync insertion of runs (`source = 'strava'`).
  5. On-demand sync via `syncStrava`.
  6. Webhook `create`, `delete`, and `deauthorize` handling.
  7. Data wipe upon disconnect.
  8. Privacy isolation: Strava runs do NOT appear in `rankMileage` leaderboards.

- [ ] **Step 1: Create `apps/web/src/scripts/check-strava.ts`**

Implement automated test script mocking `fetch` for Strava endpoints and running all 8 lifecycle assertions.

- [ ] **Step 2: Execute `check-strava.ts` against Postgres**

Run: `pnpm --filter @erc/web payload run src/scripts/check-strava.ts`
Expected: All assertions pass (e.g., `check-strava: 30 passed, 0 failed`).

- [ ] **Step 3: Update documentation (`README.md`, `todo.md`, `decisions.tsv`)**

- [ ] **Step 4: Run full workspace test suite and production build**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: All suites green.

- [ ] **Step 5: Commit Task 8**

```bash
git add apps/web/src/scripts/check-strava.ts README.md todo.md decisions.tsv
git commit -m "Add automated Strava integration test and record completion in docs"
```
