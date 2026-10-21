# ERC Phase 2: member foundation

Status: design of record, 2026-10-21. It builds on [the Phase 1 design](20261019-erc-phase-1-design.md). Evidence labels follow that document. **[V]** means verified, **[I]** means inferred, and **[G]** means a guess.

## What Phase 2 adds

Phase 1 is a site that staff curate. Phase 2 adds people who sign in and write their own data:

- member accounts;
- profiles that athletes control;
- mileage;
- leaderboards;
- saved races;
- self-reported results;
- challenges.

It also prepares for two later additions. A mobile app must be able to do everything the member dashboard does. Strava sync must stay optional and private.

Five constraints make the shape non-obvious.

1. **Members are not staff.** Every Phase 1 access rule reads "not staff" as "anonymous" (`apps/web/src/cms/access.ts`) **[V]**.
2. **The mobile app needs parity.** It must do everything the dashboard does. The main risk is two code paths drifting apart.
3. **Strava data stays with its owner.** The Strava API Agreement took effect on 2026-06-01. It says: "Strava Data provided by a specific user can only be displayed or disclosed in your Developer Application to that user" **[V]**. Two further requirements come from Strava's getting-started page **[V]**. Creating an app requires a Strava subscription. An app serves at most 10 athletes until Strava has reviewed it.
4. **Running cost stays at zero.** Everything runs on one free Arm server. Email goes through one Gmail account, which allows about 500 messages a day.
5. **Pages work without JavaScript.**

## How the design was chosen

Three models each designed this independently: Opus, Fable, and Sonnet. Opus's design is the base, with ideas taken from the other two.

They agreed on most of it:
- **Sessions.** Opaque session tokens, hashed at rest.
- **Sign-in.** No passwords.
- **API contract.** A shared `@erc/contract` package.
- **Strava.** Data typed so that only its owner can see it.
- **Ranking.** A pure TypeScript function.
- **Weeks.** Calendar weeks in IST, starting on Monday.
- **Athlete links.** One member to one athlete, with claims through moderation.

| Question | Chosen | Why |
|---|---|---|
| Are members Payload users? | **No.** Members are a private Payload record, but sessions live in our own tables (Opus and Sonnet). | If members were Payload users, every Phase 1 access function would see a second kind of user (Fable's design). Keeping them out means Payload can only ever sign in staff. It also avoids both identities sharing the one `payload-token` cookie. |
| How does a member sign in? | **An emailed six-digit code** (Opus and Sonnet). **Google** is added in slice 5. | A code works when the email is read on another device. It also survives mail scanners that open every link in a message. Fable proposed magic links, which fail in both cases. |
| How do the dashboard and the API stay in step? | **One `OPERATIONS` table and one `run()`** (Opus). | Pages and `/api/v1` both go through `run()`. The server's handler map must cover every operation in the table, so a dashboard feature can't exist without its API. Sonnet's service-plus-adapter design left parity as a convention. |
| When are duplicate runs merged? | **When they are read**, by a pure `mergeRuns` (Opus and Fable). | Each source writes only its own rows. The merge rule can change without a migration, and deleting Strava data can't leave anything orphaned. |
| Which profile edits wait for review? | Name, bio, and photo are reviewed once the profile is approved. Everything else applies immediately (Opus and Sonnet). | The rule is simple. Hiding things takes effect at once. New public words or pictures get one review. Consent to show facts that were already reviewed takes effect at once. |
| How are impossible runs handled? | **Rejected when entered** (Opus). Staff also get a "withhold from leaderboards" switch. | Sonnet flagged suspect runs for coaches to clear. A queue nobody clears would quietly drop members from the boards. |
| How does background work run? | **The host's cron calls `POST /api/tick`** (Fable). | No worker container is needed, and every step can safely run again. This matches the existing cache-prune cron job. |
| What happens when a leaderboard period ends? | It is **frozen into a snapshot 14 days after it ends** (Opus and Sonnet). | Past boards and badges never move. |
| What happens at the 10-athlete Strava cap? | **A waitlist** (Sonnet). | Members see a clear "full" state rather than an error. |

## The shape, step by step

### Step 1. Two identities, two doors

```
staff  ── payload-token cookie ──> /admin, Payload REST     (Phase 1, unchanged)
member ── erc_member cookie ─────> /me pages ─────┐
app    ── Authorization: Bearer ─> /api/v1/* ─────┴─> run(operation, caller, input)
```

**Session tokens.**
- A session token is 32 random bytes, and the database stores only its SHA-256 hash.
- There is one row per device, so a lost phone can be signed out on its own.
- Sessions slide for 90 days.
- The web keeps the token in an `__Host-` HttpOnly cookie, and the app sends it as a bearer token.
- `/api/v1` accepts only the bearer token, never the cookie, so it has no CSRF surface.
- Web forms are server actions, which Next protects with its origin check.

**Sign-in.** A member enters an email and receives a six-digit code. The code is stored hashed, lasts 10 minutes, and allows 5 attempts. Typing it in creates a session. Google sign-in is added in slice 5 as a second way to prove the same verified email.

**Age.** Members must declare they are 18 or over until the club decides how to handle younger runners (see the open questions).

### Step 2. One list of operations

```
@erc/contract  OPERATIONS = { signInStart, signInVerify, dashboard, logRun, ... }
                    │ each entry: method, path, audience, input parser, output type
                    ▼
apps/web        Implementations: { [K in keyof OPERATIONS]: Handler<K> }   (a missing handler fails typecheck)
                    │
          run(name, caller, raw) ── parse ─> check access ─> handler ─> check owner-only output
                    ▲                                        ▲
   /me pages and server actions (in-process)       /api/v1/[...path] (HTTP)
apps/mobile     createClient(OPERATIONS)   (later; built from the same table)
```

`@erc/contract` depends only on `@erc/domain`, and its wire types are domain types.

**API conventions:**
- **Errors.** There is one error shape: `{ code, message, fields? }`, with a closed list of codes.
- **Pagination.** Lists page with opaque cursors.
- **Versioning.** Changes inside `v1` are additive only. A client whose `ERC-Client` header is below the server's minimum version gets `upgrade_required`.

`proxy.ts` adds `/api/v1/` and the Strava webhook to its allowlist, because those handlers authenticate requests themselves. Payload's REST API stays staff-only.

### Step 3. Who may change what

One table, `PROFILE_FIELDS`, gives every field a rule:
- **`direct`** fields change at once: city, state, and running-since.
- **`reviewed`** fields go through moderation once the profile is approved: name, bio, and photo.
- **`private`** fields are never shown: birth year.

The collection's field access and the API's input parser both come from this table, so they can't disagree.

The member alone controls the visibility of the profile, results, and mileage. Field access refuses staff, so consent has a single owner.

Self-reported results are created as `submitted` with `submitter: { member }`. Only staff can mark a result official.

### Step 4. Activities, merged when read

```
manual form ──┐
GPX/FIT file ─┼─> parse ─> upsert (member, source, ref) ──> activities          (public sources)
Strava hook ──┘──> tick job ─────────────────────────────> strava.activities   (owner only)
                                   read time
  board:  PublicActivity[] ─> mergeRuns ─> CountedRun<PublicSource>[] ─> rankMileage
  owner:  Activity[] including Strava ─> mergeRuns ─> OwnMileage (OwnerOnly)
```

**Dates.**
- `localDate` is fixed when a run is written, using IST (UTC+05:30; India has no daylight saving).
- Weeks run from Monday 00:00 IST.
- A period closes 14 days after it ends.

**Merging.** Two timed runs are treated as the same run when they overlap by at least half the shorter one. A day-level manual entry is treated as the same run as the only timed run that day, when they are within 10% of each other. When runs merge, a file wins over Strava, and Strava wins over a manual entry.

**What is kept.** Uploaded files are reduced to a summary: date, distance, moving time, and start time. The GPS track is discarded. Heart rate is not stored in Phase 2.

**Checks at entry.** A run must have a duration. It is rejected if its pace is faster than 2:30 per km or its distance is over 250 km.

### Step 5. Leaderboards

`rankMileage` takes only `MileageEntrant`, whose runs are `CountedRun<PublicSource>`. A Strava run can't be passed in. The only `BoardMetric` is `distance`, so ranking by heart rate can't be expressed.

**Who appears.** An entrant needs three things: an approved athlete profile, profile and mileage both set to public, and not withheld by staff. This is enforced three times, the same way the race calendar enforces its rules: in the SQL query, in the row parser, and in the type.

**Categories.**
- open;
- age group, from the private birth year, so only the band is shown;
- experience, from running-since.

**Labels.** Every mileage board says "self-reported". Results boards label each row verified or self-reported, and offer a "verified only" view.

**Speed.** Each board is cached for 10 minutes and tagged, so a visibility change takes it off at once. Ranking a club of 500 runs over about 15,000 rows a month **[G]**.

### Step 6. Strava, private by construction

```
STRAVA_ENABLED=false  ──> no connect button, no panel, no job; tick truncates the strava schema
STRAVA_ENABLED=true   ──> OAuth (activity:read) ─> encrypted tokens ─> webhook hint ─> tick refetches ─> strava.activities
                                                                    deauthorise ─> purge member's rows and tokens
```

Four layers keep Strava data with its owner:
1. The only function that reads it takes a `MemberSession` and returns `OwnerOnly<T>`.
2. A public operation that would return `OwnerOnly` data fails to compile.
3. The data lives in its own Postgres schema, which `/admin` never shows, because coaches are other users.
4. `run()` checks the owner on the way out.

**Other rules.**
- **Tokens.** Encrypted with AES-256-GCM.
- **Rate limits.** The tick spends at most half of Strava's limits.
- **Retention.** `STRAVA_RETENTION_DAYS` defaults to 7 until we have read the agreement in full.
- **Athlete cap.** The cap of 10 is enforced when Strava finishes connecting, with a waitlist beyond it.
- **No path to public data.** A member who wants a Strava run on a board must log it themselves or upload the file from their watch.

### Step 7. Dashboard, saved races, challenges

- **Dashboard.** `dashboard` is one owner-only operation. It returns:
  - the member's week and month;
  - their standing on the boards;
  - saved races;
  - what's pending, with any reasons;
  - Strava status.
- **Saved races.** `saved_races` has the primary key `(member, race)`, so saving twice is harmless.
- **Challenges.** These are editorial definitions with `progressOf` over public runs. A badge is inserted once per member and challenge, after the period closes.

## Slices

| Slice | A reviewer can test |
|---|---|
| 1 | Sign in with an emailed code, log a manual run, and see this IST week's total on `/me` without JavaScript. Do the same through `/api/v1` with a bearer token. This slice also moves the two Phase 1 email caps into one `EMAIL_SHARES` table, with a test that the daily total stays under the relay's limit. |
| 2 | Claim an existing athlete profile or start one, have a coach approve it in `/admin`, and set visibility for profile, results, and mileage. |
| 3 | Public weekly and monthly mileage boards, with age and experience bands, labelled self-reported, and frozen after 14 days. |
| 4 | Self-reported result submission, results boards, saved races, and the rest of `v1`. |
| 5 | Google sign-in, plus GPX and FIT upload merged with manual entries. |
| 6 | Strava, behind `STRAVA_ENABLED`, with the cron tick, the waitlist, and deletion on deauthorisation. |
| 7 | Challenges and badges. Then `apps/mobile` on `@erc/contract`. |

Sign-in needs email. Production has no SMTP yet, so member sign-in stays switched off there until it does. Locally, the check scripts use an SMTP sink.

## Trade-offs accepted

- **A second policy path.** We accept domain rules behind `run()` alongside Payload access. In exchange, Payload never has to know about members.
- **One email per sign-in.** We accept that each sign-in costs one email. In exchange, nobody stores or resets passwords. 90-day sessions keep sign-ins rare.
- **Read-time merging costs CPU.** We accept that cost on every board read. In exchange, sources stay independent and Strava can be purged safely.
- **Slow additions to the boards.** We accept boards that lag new runs by up to 10 minutes. Hiding someone stays immediate.
- **No Strava on the boards.** We accept that Strava runs never count publicly. In exchange, a licence breach can't happen by accident.
- **No route maps.** We accept discarding GPS tracks. In exchange, the club never holds the locations of runners' homes.

## Implementation reconciliation

Slice 1 was built on 2026-10-21 (`packages/domain`, `packages/contract`, `apps/web/src/members`, `apps/web/src/scripts/check-members.ts`). Deviations from the text above, and why:

- **Email shares.** `EMAIL_SHARES` is `{ enquiry_staff_notice: 3, newsletter_confirmation: 7, sign_in_code: 10 }` an hour, 480 a day. Phase 1's 5 and 15 already summed to 480, so the two Phase 1 caps shrank to make room rather than the total growing. A vitest holds the daily sum under `RELAY_DAILY_LIMIT` (500). The two forms still count their own rows under `withCapLock`; the lock is now named by the purpose.
- **Code storage.** A sign-in code is stored as an HMAC under the server's secret, not a bare SHA-256: six digits are small enough to brute-force from a leaked table. One row is kept per code sent, for a day, so the per-address (3 an hour), per-sender (10 an hour), and site-wide limits can count them; sending a new code closes the earlier ones, so the five-try lock cannot be reset by asking again.
- **Age declaration.** The declaration is a required checkbox on the email step, asked of everyone every time, because the form must not know whether an address already has an account. It is stored once, as `ageDeclaredAt` on the member, timestamped from the code request that carried it. The JSON form of the field is `true`.
- **Tokens and carriers.** A session token is one string: the web stores it in the `__Host-erc_member` cookie and an app sends it as a bearer. `/api/v1` reads only the bearer, pages read only the cookie, and the session row records which carrier issued it. In local http runs the cookie keeps its `__Host-` name and `Secure` flag; browsers treat `localhost` as a secure origin, and the check script keeps its own cookie jar.
- **Activities in slice 1.** Manual entries are day-level, so `activities` holds `on_date`, `metres`, `moving_s`, and `logged_at`; the start time and elapsed columns arrive with file uploads in slice 5, as does `mergeRuns`, which with one source is the identity. Week and month totals are `totalsOf` over the period's rows. The run form carries a `ref` minted when it is shown, so a resubmitted form converges on one row; an API client may send one as an idempotency key.
- **Owner-only data.** `OwnerOnly` and `PublicSafe` are enforced by the compiler through the contract's `ownedBy` constructor. The runtime owner check on `run()`'s way out is deferred until an operation exists whose output could describe another member.
- **Client version header.** `ERC-Client` and `upgrade_required` are not in slice 1; they are additive and arrive with `apps/mobile`.
- **Members in `/admin`.** Staff read members and change `status`; the other fields refuse updates at field level. Admins may also delete a member, which cascades to sessions and runs, so an erasure request has a door.
- **Payload's admin and a member cookie.** `/admin` answers an anonymous visitor, and so a member cookie, with a 200 "Unauthorized" view and sends them to the login page from the client; the check asserts that rather than a redirect.

## Open questions

1. **Strava.** Creating the Strava app needs a paid Strava subscription. Does someone at the club already pay for one? Until then, Strava stays switched off.
2. **Under-18 runners.** Does the club have them? India's DPDP Act requires verifiable parental consent for anyone under 18 **[I]**, so members must declare they are 18 or over until the club decides.
3. **Strava retention.** Is the 7-day storage limit real? Strava's agreement page doesn't mention it, but a third-party summary does **[I]**.
4. **Watch files exported from Strava.** Does a GPX file a member exports from Strava count as Strava data? The design treats any uploaded file as the member's own **[G]**.
5. **Coaches and private logs.** Should coaches see a member's private log? If so, it needs the member's explicit opt-in, never a default.
6. **Start of the week.** Are Monday-start weeks right for the club's challenges?
