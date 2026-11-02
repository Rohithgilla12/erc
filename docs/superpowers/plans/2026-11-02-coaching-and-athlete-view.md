# Coaching & Athlete View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Coach ↔ Athlete interactive workflow in ERC: athlete run notes, weekly subjective check-ins, coach roster triage view, pure deterministic weekly summaries, and coach review cards with watchlists and recommendations.

**Architecture:** 
- A coach is a member whose record is linked to a `coaches` collection entry by staff in `/admin`.
- Athlete explicit opt-in via a `coaching_links` table with instant revocation.
- Private tables for check-ins and reviews outside Payload CMS collections to ensure total privacy.
- Pure domain calculation (`summariseWeek`) in `@erc/domain` generating flags and pre-filled watchlists without external AI APIs or extra hosting costs.
- Fully wired through `@erc/contract` and `run()` for zero-cost, JS-optional server actions and future mobile parity.

**Tech Stack:** Next.js 15 (App Router), Payload CMS v3, Drizzle ORM / Postgres, TypeScript, Vitest, Tailwind CSS.

## Global Constraints
- Two-identity separation: Payload `/admin` is staff-only (`payload-token`), `/me` and `/me/coach` are member sessions (`__Host-erc_member`).
- Zero new hosting cost: Server-rendered HTML and raw Postgres SQL with `ON CONFLICT`; no background queue container.
- JS-optional forms: Native `<form action={serverAction}>` with standard validation.
- Privacy: Coaches see public-source activities only (`CountedRun<PublicSource>`), never Strava rows or birth years.
- IST calendar weeks starting Monday 00:00 IST (`weekOf`, `todayIn('Asia/Kolkata')`).

---

### Task 1: Domain Models, Parsers & Summary Engine (`@erc/domain`)

**Files:**
- Create: `packages/domain/src/coaching.ts`
- Create: `packages/domain/src/coaching.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `Id`, `Metres`, `Seconds`, `RawInput`, `Result`, `ok`, `err` from `packages/domain/src/primitives.ts`; `CountedRun`, `PublicSource` from `packages/domain/src/activities.ts`.
- Produces:
  - Types: `CoachId`, `CoachingLinkState`, `CoachingLink`, `CheckInFeeling`, `AthleteCheckIn`, `WatchFlag`, `WeeklySummary`, `WeekReviewInput`, `WeekReview`.
  - Functions: `decideLink`, `endLink`, `parseCheckIn`, `parseWeekReview`, `summariseWeek`.

- [ ] **Step 1: Write failing tests in `coaching.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  decideLink,
  endLink,
  parseCheckIn,
  parseWeekReview,
  summariseWeek,
  type AthleteCheckIn,
} from './coaching'

describe('coaching domain logic', () => {
  it('decides a requested link transition', () => {
    expect(decideLink('requested', 'accept')).toBe('active')
    expect(decideLink('requested', 'reject')).toBe('ended')
    expect(decideLink('active', 'accept')).toBeNull()
  })

  it('ends an active link', () => {
    expect(endLink('active')).toBe('ended')
    expect(endLink('ended')).toBeNull()
  })

  it('parses valid check-in inputs', () => {
    const parsed = parseCheckIn({
      feeling: 'tired',
      niggles: 'Right calf tightness',
      note: 'Felt sluggish after Thursday run',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.feeling).toBe('tired')
      expect(parsed.value.niggles).toBe('Right calf tightness')
    }
  })

  it('summarises week with volume spike and niggle flags', () => {
    const thisWeek = [
      { metres: 12000, seconds: 3600, date: '2026-11-03' },
      { metres: 15000, seconds: 4500, date: '2026-11-05' },
    ]
    const lastWeek = [
      { metres: 20000, seconds: 6000, date: '2026-10-27' },
    ]
    const checkIn: AthleteCheckIn = {
      feeling: 'tired',
      niggles: 'Left shin splints',
      note: 'Tough week',
      submittedAt: '2026-11-08T18:00:00Z',
    }
    const summary = summariseWeek(thisWeek, lastWeek, checkIn)
    expect(summary.totalMetres).toBe(27000)
    expect(summary.volumeChangePct).toBe(35)
    expect(summary.flags).toContain('VOLUME_SPIKE')
    expect(summary.flags).toContain('NIGGLE_REPORTED')
    expect(summary.flags).toContain('ELEVATED_FATIGUE')
    expect(summary.suggestedWatch.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @erc/domain test coaching`  
Expected: FAIL (Cannot find module `./coaching`)

- [ ] **Step 3: Implement `packages/domain/src/coaching.ts`**

Implement types, state transitions, parsers with length caps, and `summariseWeek`:
- `parseCheckIn`: feeling in `('great' | 'good' | 'tired' | 'struggling' | 'injured')`, niggles $\le 280$ chars, note $\le 1000$ chars.
- `parseWeekReview`: watch $\le 10$ items ($\le 200$ chars each), recos $\le 10$ items ($\le 200$ chars each), note $\le 1000$ chars.
- `summariseWeek`: Calculates total distance, duration, longest run %, volume change %, evaluates `WatchFlag` rules, and populates `suggestedWatch` and `suggestedRecos`.
- Export all symbols in `packages/domain/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @erc/domain test coaching`  
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/domain/src/coaching.ts packages/domain/src/coaching.test.ts packages/domain/src/index.ts
git commit -m "Add coaching domain types, parsers, and summariseWeek engine"
```

---

### Task 2: Contract Operations & Wire Types (`@erc/contract`)

**Files:**
- Modify: `packages/contract/src/index.ts`
- Modify: `packages/contract/src/index.test.ts`

**Interfaces:**
- Consumes: Coaching types and parsers from `@erc/domain`.
- Produces:
  - Extended `Access = 'anyone' | 'member' | 'coach'`.
  - Operations: `myCoaching`, `requestCoach`, `endCoaching`, `submitCheckIn`, `myWeekReview`, `roster`, `decideCoachingRequest`, `athleteWeek`, `saveWeekReview`.
  - Enhanced `logRun` operation taking optional `note`.

- [ ] **Step 1: Write failing tests in `packages/contract/src/index.test.ts`**

Add assertions testing:
- Parsing `logRun` input with and without `note`.
- Parsing `requestCoach` input `{ coachId: number }`.
- Parsing `submitCheckIn` input.
- Parsing `saveWeekReview` input.
- Verifying access tiers for coach operations are `'coach'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @erc/contract test`  
Expected: FAIL with missing operation keys.

- [ ] **Step 3: Implement contract updates in `packages/contract/src/index.ts`**

- Update `Access` type: `export type Access = 'anyone' | 'member' | 'coach'`
- Add schemas, input parsers, and wire types:
  - `CoachRosterItem`, `AthleteWeekView`, `CoachReviewView`, `MyCoachingView`.
- Register the 9 new operations in `OPERATIONS` with method, path, access, and parse functions.
- Update `logRun` input parser to validate `note: optional(string(280))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @erc/contract test`  
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/contract/src/index.ts packages/contract/src/index.test.ts
git commit -m "Add coaching operations and coach access tier to contract"
```

---

### Task 3: Database Schema & Migration (`apps/web`)

**Files:**
- Modify: `apps/web/src/cms/collections/coaches.ts`
- Create: `apps/web/src/migrations/20261102_180000_coaching.ts` (or next sequence)

**Interfaces:**
- Consumes: Postgres connection via Payload Drizzle.
- Produces:
  - `coaches.member` relation column in Payload.
  - Tables: `coaching_links`, `check_ins`, `week_reviews`.
  - Column: `activities.note`.

- [ ] **Step 1: Add `member` field to `apps/web/src/cms/collections/coaches.ts`**

```ts
{
  name: 'member',
  type: 'relationship',
  relationTo: 'members',
  access: { read: isStaff },
  admin: {
    position: 'sidebar',
    description: 'The member account that controls this coach profile and views athlete rosters.',
  },
}
```

- [ ] **Step 2: Write migration script in `apps/web/src/migrations/`**

Create `20261102_180000_coaching.ts` implementing `up` and `down`:
- `ALTER TABLE coaches ADD COLUMN IF NOT EXISTS member_id integer REFERENCES members(id) ON DELETE SET NULL;`
- `CREATE TABLE IF NOT EXISTS coaching_links (...)` with partial unique index.
- `CREATE TABLE IF NOT EXISTS check_ins (...)`.
- `CREATE TABLE IF NOT EXISTS week_reviews (...)`.
- `ALTER TABLE activities ADD COLUMN IF NOT EXISTS note text;`

- [ ] **Step 3: Run migration against dev database**

Run: `pnpm --filter @erc/web payload migrate`  
Expected: Migration applied successfully with 0 errors.

- [ ] **Step 4: Commit Task 3**

```bash
git add apps/web/src/cms/collections/coaches.ts apps/web/src/migrations/*_coaching.ts
git commit -m "Add coaching schema migration and coaches.member field"
```

---

### Task 4: Backend Implementation & Dispatcher (`apps/web/src/members`)

**Files:**
- Modify: `apps/web/src/members/session.ts`
- Modify: `apps/web/src/members/activities.ts`
- Create: `apps/web/src/members/coaching.ts`
- Modify: `apps/web/src/members/run.ts`
- Create: `apps/web/src/scripts/check-coaching.ts`

**Interfaces:**
- Consumes: `@erc/contract` operations and `@erc/domain` logic.
- Produces: Full backend handlers for all coaching operations, with authorization checks and access control.

- [ ] **Step 1: Update `session.ts` to resolve `coachId`**

In `resolveSession`:
- Query `coaches` table to find if `member_id = row.member_id`.
- Attach `coachId: coachRow?.id ?? null` to `MemberSession`.

- [ ] **Step 2: Implement queries and mutations in `apps/web/src/members/coaching.ts`**

Implement:
- `getMyCoaching(payload, memberId)`: fetch active/pending link and coach details.
- `requestCoach(payload, memberId, coachId)`: validate coach exists, insert with `ON CONFLICT`.
- `endCoaching(payload, memberId, role)`: set state to `ended`, record `ended_at` and `ended_by`.
- `submitCheckIn(payload, memberId, weekStart, input)`: upsert into `check_ins`.
- `getMyWeekReview(payload, memberId, weekStart)`: fetch week review if link active.
- `getCoachRoster(payload, coachId)`: list assigned athletes, current week mileage, and check-in status.
- `decideRequest(payload, coachId, linkId, decision)`: accept or reject pending request.
- `getAthleteWeek(payload, coachId, athleteSlug, weekStart)`: verify active link; fetch public activities; compute `summariseWeek`.
- `saveWeekReview(payload, coachId, athleteSlug, weekStart, input)`: verify active link; upsert into `week_reviews`.

- [ ] **Step 3: Update `run.ts` to support `'coach'` access tier**

- In `run()` dispatcher:
  ```ts
  if (op.access === 'coach') {
    if (caller.kind !== 'member' || !caller.session.coachId) {
      return statusOf(403, { code: 'forbidden', message: 'You must be a designated club coach to perform this action.' })
    }
  }
  ```
- Wire all 9 operation handlers into `Implementations` in `run.ts`.
- Update `recordManual` in `activities.ts` to persist `note`.

- [ ] **Step 4: Create and run `check-coaching.ts` test script**

Create `apps/web/src/scripts/check-coaching.ts` testing:
- Linking a coach to a member.
- Member requesting coach $\rightarrow$ link created.
- Coach viewing roster and accepting request $\rightarrow$ link active.
- Athlete logging a run with a note and submitting weekly check-in.
- Coach viewing athlete week, verifying `summariseWeek` output flags, and saving week review.
- Athlete viewing coach review.
- Athlete ending coaching link $\rightarrow$ subsequent coach read returns `forbidden` or `not_found`.
Run: `pnpm --filter @erc/web payload run src/scripts/check-coaching.ts`  
Expected: All assertions pass (e.g., `check-coaching: 18 passed, 0 failed`).

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/web/src/members/session.ts apps/web/src/members/activities.ts apps/web/src/members/coaching.ts apps/web/src/members/run.ts apps/web/src/scripts/check-coaching.ts
git commit -m "Implement coaching operations, session coach resolution, and check script"
```

---

### Task 5: Athlete UI Pages & Server Actions (`apps/web`)

**Files:**
- Modify: `apps/web/src/members/actions.ts`
- Modify: `apps/web/src/app/(frontend)/me/page.tsx`
- Create: `apps/web/src/app/(frontend)/me/coaching/page.tsx`
- Create: `apps/web/src/app/(frontend)/me/check-in/page.tsx`

**Interfaces:**
- Consumes: Server actions calling `run()` for member operations.
- Produces: Server-rendered HTML and native form actions for athlete coaching interactions.

- [ ] **Step 1: Add server actions in `apps/web/src/members/actions.ts`**

Export:
- `requestCoachAction(formData: FormData)`
- `endCoachingAction(formData: FormData)`
- `submitCheckInAction(formData: FormData)`
- Update `logRunAction` to pass `note` field.

- [ ] **Step 2: Create `/me/coaching/page.tsx`**

- If no coach requested/active: show list of published coaches with credentials and "Request Coach" button.
- If pending request: show "Waiting for [Coach Name] to accept" with "Cancel Request" button.
- If active coach: show coach card, credentials, and "End Coaching" button.

- [ ] **Step 3: Create `/me/check-in/page.tsx`**

- Form with radio buttons or segmented buttons for `feeling` (Great, Good, Tired, Struggling, Injured).
- Text input for `niggles` (280 chars max).
- Textarea for `note` (1000 chars max).
- Displays validation messages if submitted with errors.

- [ ] **Step 4: Update `/me/page.tsx`**

- If athlete has an active coach:
  - Display "Your Coach: [Name]" banner with link to `/me/coaching`.
  - Display "This Week's Check-in" status (Submitted or "Submit Check-in" CTA).
  - Display "Coach Review" section if coach has published watch items & recos for this week.
- Update run logging form on `/me` to include optional "Run notes" input.

- [ ] **Step 5: Verify athlete UI build and types**

Run: `pnpm --filter @erc/web typecheck`  
Expected: PASS with 0 errors.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/web/src/members/actions.ts apps/web/src/app/\(frontend\)/me/page.tsx apps/web/src/app/\(frontend\)/me/coaching/page.tsx apps/web/src/app/\(frontend\)/me/check-in/page.tsx
git commit -m "Add athlete coaching management, check-in page, and review display"
```

---

### Task 6: Coach Roster & Weekly Review UI (`apps/web`)

**Files:**
- Modify: `apps/web/src/members/actions.ts`
- Create: `apps/web/src/app/(frontend)/me/coach/page.tsx`
- Create: `apps/web/src/app/(frontend)/me/coach/[slug]/page.tsx`

**Interfaces:**
- Consumes: Coach operations through `run()`.
- Produces: Coach roster triage page and individual athlete weekly review editor.

- [ ] **Step 1: Add coach server actions in `apps/web/src/members/actions.ts`**

Export:
- `decideCoachingAction(formData: FormData)` (accept/reject)
- `saveWeekReviewAction(formData: FormData)` (watch items, recos, note)

- [ ] **Step 2: Create `/me/coach/page.tsx` (Roster View)**

- If user is not a linked coach: render 403 Forbidden with explanation.
- If coach:
  - Pending requests queue: athlete name, requested date, "Accept" / "Decline" buttons.
  - Active roster:
    - Grouped/sorted: Flagged (niggles/fatigue/volume spike), Needs Review, On Track.
    - Summary per athlete: This week km, runs count, check-in status badge.
    - Link to `/me/coach/[slug]`.

- [ ] **Step 3: Create `/me/coach/[slug]/page.tsx` (Review Editor)**

- Shows athlete name, profile, and selected week (defaults to current IST week).
- Metrics card: Total distance, moving time, delta vs previous week.
- Runs list: Each run's date, distance, pace, and athlete's logged `note`.
- Athlete Check-in card: Feeling, niggles, and notes.
- Review Form:
  - Pre-fills `watch` and `recommendations` with suggestions from `summariseWeek`.
  - One item per line textarea for "Watch for Next Week".
  - One item per line textarea for "Recommendations for Next Week".
  - Textarea for coach notes.
  - "Publish Review" submit button.

- [ ] **Step 4: Verify coach UI build and types**

Run: `pnpm --filter @erc/web typecheck`  
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit Task 6**

```bash
git add apps/web/src/members/actions.ts apps/web/src/app/\(frontend\)/me/coach/page.tsx apps/web/src/app/\(frontend\)/me/coach/\[slug\]/page.tsx
git commit -m "Add coach roster triage view and weekly review editor"
```

---

### Task 7: Full System Verification & Documentation

**Files:**
- Modify: `todo.md`
- Modify: `README.md`
- Modify: `decisions.tsv`

- [ ] **Step 1: Run full verification suite**

Run:
1. `pnpm --filter @erc/domain test`
2. `pnpm --filter @erc/contract test`
3. `pnpm --filter @erc/web payload run src/scripts/check-coaching.ts`
4. `pnpm typecheck`
5. `pnpm build`
Expected: All suites green with 0 errors.

- [ ] **Step 2: Record decisions and update documentation**

- Update `todo.md` marking Coaching & Athlete View tasks complete.
- Update `decisions.tsv` logging the architectural closure of Open Question 5 (Coaching link opt-in & private tables).
- Update `README.md` command listing with `check-coaching.ts`.

- [ ] **Step 3: Commit Task 7**

```bash
git add todo.md README.md decisions.tsv
git commit -m "Record coaching implementation and verify full test suite"
```
