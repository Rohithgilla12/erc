# Design Spec: Strava Sync Integration (Slice 6)

**Date:** 2026-11-03  
**Status:** Approved by Operator  
**Topic:** Strava OAuth Sync, Rate-Limiting, Waitlist & Webhooks for Endurance Run Club (ERC)  
**File:** `docs/superpowers/specs/2026-11-03-strava-sync-design.md`

---

## 1. Context & Motivation

In Endurance Run Club (ERC), athletes log workouts to track mileage and share notes with their club coaches. Previously, runs could only be entered manually or uploaded as watch files (`.fit` / `.gpx`). 

Strava is the primary running app used by club members. Enabling direct Strava synchronization allows athletes to seamlessly pull their training runs into ERC without double-entry.

However, Strava integration is subject to two critical real-world constraints:
1. **Strava Developer Policy & Privacy Agreement (effective 2026-06-01):** "Strava Data provided by a specific user can only be displayed or disclosed in your Developer Application to that user." Strava data can **never** be posted to public leaderboards or shared publicly without express manual intervention.
2. **Strava API Rate Limits & Pilot Cap:** Unreviewed developer applications are restricted to **10 connected athletes** and **100 requests per 15 minutes** (1,000 / day).
3. **Paid Subscription Requirement:** Creating a Strava developer application requires an active paid Strava subscription (provided by the club's running coach lead).

This specification establishes **Slice 6 (Strava Sync)**, fully satisfying ERC's two-identity architecture, progressive enhancement (JS-optional), and zero-cost hosting model.

---

## 2. Goals & Non-Goals

### Goals
- **OAuth 2.0 Connect Flow:** Seamless member authorization linking an ERC member account to a Strava athlete account (`activity:read` scope).
- **Security & Token Encryption:** Access and refresh tokens encrypted at rest with AES-256-GCM using keys derived from `PAYLOAD_SECRET`.
- **Pilot Cap & Waitlist:** Enforce a configurable 10-athlete limit (`STRAVA_ATHLETE_CAP=10`) with an automated waitlist when capacity is reached.
- **Initial 90-Day Import:** On initial connection, import runs from the past 90 days in a single efficient HTTP call (`per_page=200`, `after=epoch_90_days_ago`).
- **Dual Sync Mechanisms:**
  - **On-Demand:** A "Sync Strava Now" server action on `/me`.
  - **Real-Time Webhook:** Webhook subscription receiver handling `activity.create`, `activity.delete`, and `athlete.deauthorize`.
- **Strict Privacy Invariant:** Strava runs are stored with `source = 'strava'` and are strictly isolated from public leaderboards (`PUBLIC_SOURCES = ['manual', 'file']`).
- **Immediate Revocation & Purge:** Disconnecting on ERC or deauthorizing on Strava permanently purges all tokens and Strava-sourced activity rows for that member.
- **Automated Verification:** Comprehensive integration script (`check-strava.ts`) running against Postgres.

### Non-Goals
- **Public Leaderboard Sync:** Strava activities will **never** count toward public mileage boards or race results boards without an explicit manual file upload or self-report.
- **Heart Rate & GPS Maps Storage:** ERC does not store or process GPS coordinate streams (polylines) or heart rate series, protecting athlete privacy and bounding storage.
- **Background Worker Daemon:** No background polling container or daemon; synchronization operates via webhooks and user-initiated on-demand requests.

---

## 3. Architecture & Data Flow

```
[Strava OAuth Consent] 
        │ (auth code)
        ▼
[GET /api/v1/strava/callback] ───► Verify CSRF State
        │
        ├──► If connected_count >= STRAVA_ATHLETE_CAP ──► Store 'waitlisted' ──► Redirect /me?strava=waitlisted
        │
        └──► If within cap ──► Exchange code for Tokens (AES-256-GCM encrypt)
                                 │
                                 ├──► Store in `strava_connections` (status: 'connected')
                                 │
                                 └──► Trigger Initial Sync (past 90 days)
                                         │
                                         ▼
                                 Upsert into `activities` (source: 'strava')
                                         │
                                         ▼
                                 Redirect to `/me?strava=connected`
```

---

## 4. Environment Configuration

Add the following environment variables to `apps/web/.env`:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `STRAVA_ENABLED` | Feature flag gating UI and endpoints | `true` |
| `STRAVA_CLIENT_ID` | Numeric Strava API Application ID | `123456` |
| `STRAVA_CLIENT_SECRET` | 40-character hex application secret | `0123456789abcdef...` |
| `STRAVA_REDIRECT_URI` | Full OAuth redirect URI | `http://localhost:3000/api/v1/strava/callback` |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Arbitrary secure secret for webhook verification handshake | `crypto.randomUUID()` |
| `STRAVA_ATHLETE_CAP` | Max concurrent connected athletes | `10` |

---

## 5. Database Schema & Migration

### Table: `strava_connections`
```sql
CREATE TABLE strava_connections (
  member_id BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  athlete_id BIGINT NOT NULL,
  access_token TEXT NOT NULL,              -- AES-256-GCM ciphertext:iv:authTag
  refresh_token TEXT NOT NULL,             -- AES-256-GCM ciphertext:iv:authTag
  token_expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL,                     -- e.g. 'read,activity:read'
  status TEXT NOT NULL DEFAULT 'connected',-- 'connected' | 'waitlisted' | 'disconnected'
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_strava_athlete_id ON strava_connections(athlete_id);
CREATE INDEX idx_strava_status ON strava_connections(status);
```

### Table: `activities` (Existing Table Integration)
Runs ingested from Strava populate the existing `activities` table:
- `member_id`: The ERC member id.
- `source`: `'strava'`.
- `ref`: `'strava:<activity_id>'` (e.g. `'strava:123456789'`).
- `on_date`: Run date in IST (`Asia/Kolkata`), parsed from Strava's `start_date_local`.
- `metres`: Integer metres from Strava's `distance`.
- `moving_s`: Moving time in seconds from Strava's `moving_time`.
- `note`: Set to Strava workout title (or null).
- `logged_at`: Ingestion timestamp.

Conflict Resolution:
`ON CONFLICT (member_id, source, ref) DO UPDATE SET on_date = EXCLUDED.on_date, metres = EXCLUDED.metres, moving_s = EXCLUDED.moving_s, note = EXCLUDED.note;`

---

## 6. Token Encryption Specification

Tokens are encrypted using AES-256-GCM with a 96-bit random IV and 128-bit authentication tag.

- **Key Derivation:**
  ```ts
  import { scryptSync } from 'node:crypto'
  const encryptionKey = scryptSync(process.env.PAYLOAD_SECRET!, 'erc-strava-encryption-salt', 32)
  ```
- **Ciphertext Storage Format:**
  `"${iv.toString('hex')}:${authTag.toString('hex')}:${encryptedContent.toString('hex')}"`
- **Decryption Safeguard:**
  If decryption fails or authentication tag is invalid, throw a distinct error and mark the connection as `disconnected`.

---

## 7. OAuth Flow & Cap Management

### 1. Initiate Route: `GET /api/v1/strava/connect`
- **Preconditions:** Caller must have a valid member session (`MemberSession`).
- **Rate Check:** Verify member has not initiated >10 auth attempts in an hour.
- **State Parameter:**
  `state = "${session.member}.${createHmac('sha256', PAYLOAD_SECRET).update(session.member.toString()).digest('hex')}"`
- **Redirect Target:**
  ```
  https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${ENCODED_REDIRECT_URI}&response_type=code&scope=read,activity:read&approval_prompt=auto&state=${state}
  ```

### 2. Callback Route: `GET /api/v1/strava/callback`
- **Inputs:** `code`, `state`, `scope`, optional `error`.
- **Validation:**
  - If `error === 'access_denied'`, redirect to `/me?strava=denied`.
  - Parse `state`, verify HMAC signature, and ensure matching current session.
  - Check requested scope includes `activity:read`.
- **Pilot Cap Check:**
  - Count rows with `status = 'connected'`.
  - **If `>= STRAVA_ATHLETE_CAP` (and member is not already connected):**
    - Insert or update `strava_connections` with `status = 'waitlisted'`, dummy tokens, and `athlete_id`.
    - Redirect to `/me?strava=waitlisted`.
  - **If `< STRAVA_ATHLETE_CAP`:**
    - Call `POST https://www.strava.com/oauth/token` with `grant_type: 'authorization_code'`.
    - Encrypt `access_token` and `refresh_token`.
    - Upsert into `strava_connections` with `status = 'connected'`.
    - Execute initial sync (last 90 days).
    - Redirect to `/me?strava=connected`.

---

## 8. Sync Logic & Token Refresh

### Token Refresh Helper (`getValidStravaToken`)
```ts
if (token_expires_at <= now() + 300_000) { // Expiring within 5 minutes
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: decryptedRefreshToken,
    }),
  })
  // Handle 400 invalid_grant (revocation on Strava) -> mark status = 'disconnected'
  // Encrypt and persist new access_token, refresh_token, token_expires_at
}
```

### 90-Day Initial & On-Demand Sync
- Calculate `after = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000)` (for initial) or `Math.floor(last_synced_at.getTime() / 1000) - 3600` (for on-demand, with 1-hour overlap to catch edits).
- Request: `GET https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`.
- Filter: `activity.type === 'Run' || activity.sport_type === 'Run'`.
- Skip activities without valid distance or duration.
- Upsert into `activities`.
- Update `last_synced_at = now()`.

---

## 9. Webhook Lifecycle

### 1. Subscription Handshake: `GET /api/v1/strava/webhook`
- Strava queries: `hub.mode`, `hub.challenge`, `hub.verify_token`.
- Verification:
  ```ts
  if (query.get('hub.mode') === 'subscribe' && query.get('hub.verify_token') === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ 'hub.challenge': query.get('hub.challenge') }, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
  ```

### 2. Event Dispatcher: `POST /api/v1/strava/webhook`
Strava posts JSON events:
```json
{
  "object_type": "activity" | "athlete",
  "aspect_type": "create" | "update" | "delete",
  "object_id": 123456789,
  "owner_id": 9876543,
  "subscription_id": 1,
  "event_time": 1700000000,
  "updates": {}
}
```
- **`object_type === 'activity'` and `aspect_type === 'create'`:**
  - Find `member_id` via `owner_id = athlete_id`.
  - Fetch full activity details via `GET /activities/{object_id}`.
  - If it's a Run, upsert into `activities`.
- **`object_type === 'activity'` and `aspect_type === 'delete'`:**
  - Find `member_id` via `owner_id = athlete_id`.
  - Delete `WHERE member_id = $1 AND source = 'strava' AND ref = 'strava:${object_id}'`.
- **`object_type === 'athlete'` and `updates.authorized === 'false'`:**
  - Deauthorization event: purge all tokens and `source = 'strava'` activities for this athlete.

---

## 10. Member UI & Server Actions ([`/me`](file:///Users/rohithgilla/github.com/Rohithgilla12/erc/apps/web/src/app/(frontend)/me/page.tsx))

### UI Card: "Strava Sync"
- **Hidden:** When `STRAVA_ENABLED !== 'true'`.
- **Disconnected & Under Cap:**
  - Explanatory copy: *"Automatically sync your runs into your private ERC log."*
  - Link styled as primary button: `Connect Strava` (`href="/api/v1/strava/connect"`).
- **Disconnected & At Cap:**
  - Banner: *"The Strava pilot is currently full (10/10 athletes connected)."*
  - Button: `<form action={joinStravaWaitlistAction}><button>Join Pilot Waitlist</button></form>`.
- **Waitlisted:**
  - Banner: *"You are on the Strava pilot waitlist. We will notify you when capacity expands."*
  - Button: `<form action={leaveStravaWaitlistAction}><button>Leave Waitlist</button></form>`.
- **Connected:**
  - Status banner with green indicator: *"Strava Connected (Athlete #{athlete_id})"*
  - Timestamp: *"Last synced: [relative time, e.g. 12 minutes ago]"*
  - Primary button: `<form action={syncStravaAction}><button>Sync Now</button></form>`
  - Subtle link/button: `<form action={disconnectStravaAction}><button>Disconnect</button></form>`

All forms are native HTML `<form action={serverAction}>` with server-side redirects and revalidation.

---

## 11. Testing & Verification Plan

1. **Domain & Contract Tests:**
   - Test Strava activity parsing, IST date conversion, and deduplication.
   - Verify contract endpoints and access tier rules.
2. **Automated Integration Script (`apps/web/src/scripts/check-strava.ts`):**
   - Mock Strava API server endpoints (`/oauth/token`, `/api/v3/athlete/activities`, `/oauth/deauthorize`).
   - Test full lifecycle:
     - Member connects via OAuth callback.
     - Token encryption verified in database.
     - 10-athlete cap enforcement & waitlist behavior.
     - Initial 90-day sync inserts runs correctly with `source = 'strava'`.
     - On-demand sync via `syncStravaAction`.
     - Webhook `create`, `delete`, and `deauthorize` events.
     - Complete data wipe upon disconnect.
     - Leaderboard isolation (verifying Strava runs never appear in `rankMileage`).
3. **Full Suite Gate:**
   - `pnpm test` (vitest).
   - `pnpm typecheck` (tsc).
   - `pnpm build` (Next.js production compilation).
