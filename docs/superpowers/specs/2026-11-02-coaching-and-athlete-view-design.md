# Design Spec: Coaching & Athlete View (Notes, Inputs, Summaries, Recos)

**Date:** 2026-11-02  
**Status:** Approved design, ready for implementation planning  
**Context:** Builds on [ERC Phase 1 Design](../../20261019-erc-phase-1-design.md) and [ERC Phase 2 Design](../../20261021-erc-phase-2-design.md). Closes Phase 2 Open Question 5 (*Coaches and private logs*).

---

## 1. Goal and Problem Statement

ERC has editorial coach profiles, member accounts, and basic mileage logging. However, athletes and coaches cannot interact:
1. **Athletes** cannot record workout notes, subjective biofeedback (RPE, feeling, soreness/niggles), or submit weekly check-ins.
2. **Coaches** cannot view their roster of athletes, monitor weekly compliance, review biofeedback, or prescribe weekly watchlists and recommendations.
3. **One coach manages multiple athletes**: The coach view must support an exception-based roster triage workflow, not just one-off individual browsing.

This design introduces the **Coach ↔ Athlete connection**, workout-level notes, weekly athlete check-ins, deterministic weekly summaries, and coach review cards with watchlists and recommendations.

---

## 2. Core Architecture & Identities

### Two Identities Preserved
* **Staff (`/admin`)**: Authenticate via Payload CMS (`payload-token`). Staff manage club-level editorial content, approve athlete profile claims, and link coach records to members.
* **Members & Coaches (`/me`, `/me/coach`, `/api/v1`)**: Authenticate via 6-digit email codes (`__Host-erc_member` cookie or Bearer token). Dispatched through `run(operation, caller, input)`.

### How a Member Becomes a Coach
* A coach is a **Member** whom staff have linked to a published `coaches` record in Payload CMS (`coaches.member` relation, staff-only write/read).
* When a member signs in, their session dynamically resolves `coachId: CoachId | null`.
* The contract gains a third access tier: `Access = 'anyone' | 'member' | 'coach'`.
* A caller without `session.coachId` attempting a `coach` operation is rejected with `forbidden`.

### Privacy by Construction (Closing Open Question 5)
* **Explicit Opt-in**: An athlete must explicitly request/choose an approved coach.
* **Mutual Acceptance**: The coach accepts the athlete onto their roster.
* **Instant Revocation**: Either the athlete or the coach can terminate the link at any moment. From that exact instant, all coach reads for that athlete refuse.
* **Boundary Rules**:
  - Coaches see **only public-source runs** (`CountedRun<PublicSource>`), never Strava rows (`strava.activities`), even if Strava sync is enabled.
  - Coaches **never see private fields** (e.g., birth year).
  - Private check-ins and coaching reviews live in dedicated Postgres tables, completely separate from Payload CMS collections so no unassigned staff or other coaches can browse them.

---

## 3. Data Model

### Postgres Tables (Raw SQL with migrations)

#### 1. `coaching_links`
Manages the 1-to-many relationship (one coach has multiple athletes; an athlete has at most one active coach).
```sql
CREATE TABLE IF NOT EXISTS coaching_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_member uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  coach_id integer NOT NULL, -- references coaches.id
  state text NOT NULL CHECK (state IN ('requested', 'active', 'ended')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  ended_at timestamptz,
  ended_by text CHECK (ended_by IN ('athlete', 'coach', 'staff'))
);

-- At most one open (requested or active) link per athlete
CREATE UNIQUE INDEX IF NOT EXISTS coaching_links_active_athlete_idx
  ON coaching_links (athlete_member)
  WHERE state IN ('requested', 'active');

CREATE INDEX IF NOT EXISTS coaching_links_coach_state_idx
  ON coaching_links (coach_id, state);
```

#### 2. `activities.note`
Enhance the existing `activities` table with an optional athlete note:
```sql
ALTER TABLE activities ADD COLUMN IF NOT EXISTS note text;
```
* Max length: 280 characters.
* Stored on manual run entry and file uploads.

#### 3. `check_ins`
Weekly subjective check-ins submitted by the athlete:
```sql
CREATE TABLE IF NOT EXISTS check_ins (
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  week_start_date date NOT NULL, -- Monday of the week in IST
  feeling text NOT NULL CHECK (feeling IN ('great', 'good', 'tired', 'struggling', 'injured')),
  niggles text,                  -- Max 280 chars description of soreness/pain
  note text,                     -- Max 1000 chars general athlete comments
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, week_start_date)
);
```

#### 4. `week_reviews`
Weekly summary, watch items, and recommendations published by the coach:
```sql
CREATE TABLE IF NOT EXISTS week_reviews (
  link_id uuid NOT NULL REFERENCES coaching_links(id) ON DELETE CASCADE,
  week_start_date date NOT NULL, -- Monday of the week in IST
  watch jsonb NOT NULL DEFAULT '[]'::jsonb,           -- string array, max 10 items
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb, -- string array, max 10 items
  note text,                                         -- Max 1000 chars coach feedback
  shared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, week_start_date)
);
```

---

## 4. Pure Domain Logic (`packages/domain/src/coaching.ts`)

### Deterministic Weekly Summary (`summariseWeek`)
No external LLM calls or server costs. The summary and flags are computed by a pure TypeScript function:

```ts
export type WatchFlag =
  | 'VOLUME_SPIKE'       // Weekly distance increased > 10% vs prior week
  | 'NO_REST_DAY'        // 7 days run in the week
  | 'LONG_RUN_HEAVY'     // Longest single run is > 40% of total weekly volume
  | 'ELEVATED_FATIGUE'   // Athlete logged feeling 'tired' or 'struggling'
  | 'NIGGLE_REPORTED'    // Athlete flagged soreness or pain
  | 'MISSED_LOGS'        // Zero runs logged for the week

export type WeeklySummary = {
  totalMetres: Metres
  totalSeconds: Seconds
  runCount: number
  longestRunMetres: Metres
  previousWeekMetres: Metres | null
  volumeChangePct: number | null
  flags: readonly WatchFlag[]
  suggestedWatch: readonly string[]
  suggestedRecos: readonly string[]
}
```

#### Pre-filling Rules:
* If `VOLUME_SPIKE` $\rightarrow$ Auto-suggests: `"Monitor adaptation after a {{pct}}% volume increase; do not increase mileage next week."`
* If `NIGGLE_REPORTED` $\rightarrow$ Auto-suggests: `"Check {{niggle_text}} on warm-up; abort if pain exceeds 3/10."`
* If `ELEVATED_FATIGUE` $\rightarrow$ Auto-suggests: `"Prioritize 8+ hrs sleep and keep mid-week easy runs strictly Zone 1/2."`
* The coach can freely edit, delete, or add custom watch items and recommendations before submitting.

---

## 5. Contract Operations (`packages/contract`)

```ts
export const OPERATIONS = {
  // Member - Coaching management
  myCoaching:           { method: 'GET',  path: '/me/coaching',        access: 'member' },
  requestCoach:         { method: 'POST', path: '/me/coaching/request', access: 'member' },
  endCoaching:          { method: 'POST', path: '/me/coaching/end',     access: 'member' },
  submitCheckIn:        { method: 'POST', path: '/me/check-in',         access: 'member' },
  myWeekReview:         { method: 'GET',  path: '/me/week-review',      access: 'member' },

  // Coach - Roster & athlete review
  roster:               { method: 'GET',  path: '/coach/roster',        access: 'coach' },
  decideCoachingRequest:{ method: 'POST', path: '/coach/requests/decide', access: 'coach' },
  athleteWeek:          { method: 'GET',  path: '/coach/athletes/week', access: 'coach' },
  saveWeekReview:       { method: 'POST', path: '/coach/athletes/review', access: 'coach' },
  
  // Existing operation enhancement
  logRun:               { method: 'POST', path: '/me/runs',             access: 'member' }, // gains optional note
}
```

---

## 6. User Interface & Workflows

### 1. Athlete Interface (`/me`, `/me/coaching`, `/me/check-in`)
* **/me Dashboard**:
  - Displays assigned coach header (with coach name, photo, and link to profile).
  - Current week review card from coach (Watch items & Recommendations).
  - Quick action: "Submit Weekly Check-In".
* **/me/runs Form**:
  - Distance, moving time, date, plus new **"Run notes & feeling"** (280 chars max).
* **/me/check-in**:
  - Clean, progressive form:
    - Feeling: 5 buttons (`Great`, `Good`, `Tired`, `Struggling`, `Injured`).
    - Niggles / Soreness: Input field (e.g. "Right heel sore on Saturday").
    - Notes: Freeform text box.
* **/me/coaching**:
  - Choose a coach from the club's published coaching team.
  - "End Coaching" button with immediate confirmation.

### 2. Coach Interface (`/me/coach`, `/me/coach/[athleteSlug]`)
* **/me/coach (Roster Triage)**:
  - Header: Coach profile, active athlete count, pending requests.
  - Triage Matrix:
    - **Flagged Athletes**: High fatigue, reported niggles, or volume spikes.
    - **Pending Check-Ins / Reviews**: Athletes waiting for Sunday review.
    - **All Clear**: Athletes compliant and on track.
* **/me/coach/[athleteSlug] (Weekly Deep-Dive & Review Editor)**:
  - Athlete's weekly runs and notes (Monday to Sunday IST).
  - Summary badges: Total km, total time, delta vs last week.
  - Athlete check-in card (feeling & niggles).
  - Pre-populated Review Form:
    - **Watch for Next Week** (one item per line).
    - **Recommendations for Next Week** (one item per line).
    - **Coach Note**.
    - "Publish Review" button.

---

## 7. Delivery Slices

1. **Slice A: Athlete Foundations & Coaching Link**
   - Migration for `coaches.member`, `coaching_links`, `check_ins`, and `activities.note`.
   - Domain logic: `coaching.ts` types, link state transitions, check-in parser.
   - Operations: `myCoaching`, `requestCoach`, `endCoaching`, `submitCheckIn`.
   - UI on `/me/coaching`, `/me/check-in`, and updated run logger.
   - Verified with comprehensive test suite (`check-coaching.ts`).

2. **Slice B: Coach View, Summary Engine & Weekly Reviews**
   - Domain logic: `summariseWeek()` and `parseWeekReview()`.
   - Operations: `roster`, `decideCoachingRequest`, `athleteWeek`, `saveWeekReview`.
   - UI on `/me/coach` (Roster triage) and `/me/coach/[athleteSlug]` (Review publisher).
   - Display coach review on athlete `/me` dashboard.

3. **Slice C: Automation & Parity**
   - Sunday check-in reminder email tick via `POST /api/tick` (integrated into `EMAIL_SHARES`).
   - Mobile client contract bindings.

---

## 8. Spec Self-Review Checklist
- [x] **Placeholder scan:** No unresolved "TODO" or "TBD" items; concrete schemas and endpoints specified.
- [x] **Internal consistency:** Respects the two-identity model (Payload staff vs Member sessions) and Phase 2 privacy invariants.
- [x] **Scope check:** Sliced into Slice A (Athlete + Link) and Slice B (Coach + Reviews).
- [x] **Zero-cost / JS-optional:** Server-rendered Next.js pages, pure domain functions, raw Postgres, no LLM API dependencies.
