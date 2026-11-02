# Feature: Phase 1 domain + race calendar

- [x] 1. `how` over the affected subsystem. skip: greenfield; grounding was the brief and the boxy inspection
- [x] 2. `architect` for parallel design exploration. done: 3-runner arena + cross-judge, docs/20261019-erc-phase-1-design.md
- [x] 3. Throughput checkpoint
  - Blocking first steps: baseline commit with all new deps installed (vitest in domain, storage-s3 in web), so worktrees branch from it and nobody edits the lockfile
  - Independent workstreams: A = packages/domain implementations + tests; B1 = apps/web CMS foundations (kinds, staff, races collection, indexes, R2 adapter, local Postgres, migrations). Disjoint folders.
  - Shared mutable state: pnpm-lock.yaml and package.json frozen after baseline; delegates report needed deps instead of adding them
  - Smallest safe decomposition: two owners now (A, B1); B2 (findRaces, facets, seed, EXPLAIN, pages, .ics) waits for both because it needs real domain functions and the schema
- [ ] 4. Delegate code-writing (opus, worktrees)
- [ ] 5. Verify on the matching surface (tests, build, migrations against real Postgres, EXPLAIN, rendered pages)
- [ ] 6. Small ordered commits
- [ ] 7. interrogate if contested. skip unless review disagrees
- [ ] 8. Opening a PR. skip: no remote yet; ask operator

## Tracked gaps (add to design doc after B2 merges; B2 holds that file now)
- [ ] Workflow: editing a published post and pressing Publish goes live without review; no "published with pending revision" state. Must be designed before posts ship.
- [ ] Moderation: submitter and submitted-at are not stored; no hook calls `decide`. Needed before public race submissions.
- [ ] ICS for postponed races uses the original start date; product call.
- [ ] Midnight IST refresh of "upcoming" race lists.
- [ ] Image sizes and remote patterns for the R2 domain.

## Review of B1 (Fable), scratchpad/review-b1.md
- [ ] H1 draft saves of published editorial docs stamped `published` in versions; anonymous `?draft=true` reads them. Fix in workstream C.
- [ ] H2 authors can push live edits to published docs with no action. Fix in C.
- [x] M1 admin Publish/Unpublish silently no-op; `req.context.workflowAction` has no writer. Fix in C.
- [x] M2 any staff role can approve races and set decidedBy; `decide()` unused. Fix in C (moderation half).
- [x] M3 lint pattern globs did not match nested imports. Fixed on main.
Workstream C = editorial workflow redesign (live vs working copy) + moderation through decide(). Starts after B2 merges, because both touch src/cms/kinds.ts.

## Operator decisions 2026-10-19
- Revisions to published posts go through review too (submit, review, publish). Shapes workstream C:
  EditorialState splits into `live` (none | published) and `revision` (none | draft | in_review | changes_requested | scheduled).
  Publishing promotes the revision to live. Payload `_status` on the main row derives from `live`; the working copy is the latest draft version, never stamped published.
- Apply emil-design-eng to the public UI. Workstream D, frontend only, after B2 merges:
  easing tokens (--ease-out cubic-bezier(0.23,1,0.32,1)), :active scale(0.97) on chips/buttons/cards, hover gated by (hover:hover) and (pointer:fine),
  no `transition: all`, UI motion under 300ms, prefers-reduced-motion keeps opacity only, CSS cross-document view transitions for filter navigation
  (progressive, works with JS off), short stagger only on first paint of result cards, never on repeat filter changes. Reply must include a Before/After/Why table.

## Review of B2 (Fable), scratchpad/review-b2.md. No high findings. Workstream E after C and D merge (touches content, layout, cms/revalidate).
- [x] M1 facet counts: make each chip's count equal what tapping yields (toggled selection) via count(*) FILTER in one statement; fix the smoke oracle so it computes the toggled query independently.
- [x] M2 unbounded cache keys: do not cache misses or free-text searches; clamp page to totalPages.
- [x] M3 config module that throws at production startup without ERC_SITE_URL and REVALIDATE_SECRET.
- [x] M4 revalidate in-process first, HTTP fallback only when outside a Next server.
- [x] Lows from the review file.

## From D review (my screenshot check)
- [x] E: fixed Filters button covers the last visible card; add bottom padding to the result list.
- [x] E: postponed race detail shows "Postponed to 22 Nov" badge but Date row still says 6 Nov; Date row should lead with the new date and show the original as "originally".
- [ ] Decide: JS budget. /races ships 138 KB (all React DOM + App Router runtime; HTML renders without it, LCP unaffected locally). Budget of 100 KB was a guess; options: accept and restate, or move public pages off React hydration.
- [ ] Consider card press scale 0.98 and darker chip borders (2.06:1 in light).

## From the trail review (sonnet)
- [ ] Operator: move ~/erc/first-admin.txt into 1Password, delete it, consider changing the password after first login.
- [ ] Back up /data/media/erc/uploads (add to boxy-backup.sh restic paths) or switch to R2 before real uploads.
- [ ] Cloudflare rate-limit rule on erc.gilla.fun/api/staff/login (free plan allows one, as homesy uses), and confirm Payload's login lockout settings.

## Phase 1 completion (operator approved 2026-10-19), base 5fed5cd
- [x] Baseline: brand (logo mark, favicon, orange tokens with contrast rules), SITE_SECTIONS nav, shared rich-text renderer, email adapter dep, Dockerfile copies public/
- [x] W1 pages (home/about/coaching/contact) + enquiries form + SMTP config  [running]
- [x] W2 learn (topics/posts/videos/coach profiles)  [running]
- [x] W3 training plans + resources + /downloads  [running]
- [x] W4 athletes + results directory  [running]
- [x] Integrate: merge W1..W4 one by one, generate one committed migration per merge, full suite, review each (Fable)
- [x] W5 after merge (split W5a/W5b, both merged): sitemap/robots/RSS, JSON-LD audit, Umami analytics container, newsletter (subscribers + double opt-in + footer form), home wiring of latest posts/plans
- [ ] Deploy, seed placeholder content in prod? (ask operator), public checks
- Operator needs to provide: SMTP (club Gmail app password) for forms/newsletter; real content

## Phase 1 review (Fable), scratchpad/review-phase1.md. Workstream F after W5a and W5b merge, before deploy.
- [ ] H1 submitter name/email readable on approved records via REST: field read access isStaff
- [ ] M1 disable GraphQL; proxy.ts 404s anonymous /api/* except /api/staff/*, /api/:collection/file/*, /api/revalidate
- [ ] M2 global hourly cap on enquiry notification emails (store still), no JS challenge
- [ ] M3 one mediaUrl (same-origin rule) in content/published.ts, delete the other three
- [ ] M4 remaining duplicates beyond W5a: content modules import parse helpers from published.ts, one structured-data module, one select-options helper
- [ ] Lows: sanitize rich-text link hrefs with parseLinkHref, client IP from cf-connecting-ip behind the tunnel, missing races/trainingPlans cache tags on post/video reads, hand-synced content-kind list

## Coaching & Athlete View (Phase 2 Open Question 5)
- [x] Task 1: Domain types and rules (`@erc/domain` vitest 20 test files, 595 tests green)
- [x] Task 2: Contract operations, schemas, and typed client methods (`@erc/contract` vitest 28 tests green)
- [x] Task 3: Postgres collections (`coachingLinks`, `athleteCheckIns`, `coachWeekReviews`), migration, run notes field, and server operations in `@erc/web`
- [x] Task 4: Athlete coaching view (`/me/coaching`), weekly check-in form (`/me/check-in`), and review display
- [x] Task 5: Athlete profile coach banner and navigation integration
- [x] Task 6: Coach roster triage view (`/me/coach`) and athlete weekly review editor (`/me/coach/[slug]`)
- [x] Task 7: Full verification suite (`check-coaching.ts` 57 PASS 0 FAIL; turbo typecheck & build green)
