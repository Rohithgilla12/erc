# ERC

Website for ERC: race calendar, training plans, learning centre, athlete profiles, coaching portal, and member Strava sync. Phase 3 design: [docs/20261127-erc-phase-3-design.md](docs/20261127-erc-phase-3-design.md). Design: [docs/20261019-erc-phase-1-design.md](docs/20261019-erc-phase-1-design.md). Analytics and newsletter setup: [docs/20261020-analytics-and-newsletter.md](docs/20261020-analytics-and-newsletter.md). Phase 2 design: [docs/20261021-erc-phase-2-design.md](docs/20261021-erc-phase-2-design.md). Strava design: [docs/superpowers/specs/2026-11-03-strava-sync-design.md](docs/superpowers/specs/2026-11-03-strava-sync-design.md).

## Layout

- `apps/web`: Next.js and Payload CMS (public site, `/admin`, API)
- `packages/domain`: framework-free domain types and rules, shared by every app
- `packages/tsconfig`: shared TypeScript settings
- `infra/boxy`: Docker Compose deployment for the server
- `infra/dev`: local Postgres on port 54329

## Commands

```sh
pnpm install
pnpm typecheck
pnpm build
docker build -f apps/web/Dockerfile -t erc-web .
```

Copy `apps/web/.env.example` to `apps/web/.env` for local work.

The schema changes only through migrations, in development too (`push` is off). Production applies pending migrations on boot.

```sh
docker compose -f infra/dev/compose.yaml up -d
pnpm --filter @erc/web payload migrate                       # apply migrations
pnpm --filter @erc/web payload migrate:create <name>         # after changing a collection
pnpm --filter @erc/web payload run src/scripts/check-record-access.ts   # ERC_CHECK_URL=<site> adds the REST cases and the API gate
pnpm --filter @erc/web payload run src/scripts/check-write-rules.ts     # ERC_CHECK_URL=<site> adds the REST cases
pnpm --filter @erc/web payload run src/scripts/check-race-hook.ts
pnpm --filter @erc/web payload run src/scripts/seed-races.ts          # 3,000 synthetic races, replaced on re-run
pnpm --filter @erc/web payload run src/scripts/seed-real-races.ts     # 39 verified real races, upserted by slug; deletes the synthetic ones, so run it last: check-race-calendar, check-seo and check-nearest-news need seed-races data
pnpm --filter @erc/web payload run src/scripts/check-race-calendar.ts # after seeding; over real races only, its unapproved-race case fails
pnpm --filter @erc/web payload run src/scripts/check-revalidation.ts  # with the site running
pnpm --filter @erc/web payload run src/scripts/check-tag-expiry.ts    # no site or database; an expired tag drops a cached read at once when the wall clock runs ahead
pnpm --filter @erc/web payload run src/scripts/seed-athletes.ts       # six placeholder athletes, replaced on re-run
pnpm --filter @erc/web payload run src/scripts/check-athletes.ts      # ERC_CHECK_URL=<site> adds REST and page cases
pnpm --filter @erc/web payload run src/scripts/seed-learn.ts          # placeholder topics, coaches, posts and videos, upserted by slug
pnpm --filter @erc/web payload run src/scripts/check-learn.ts         # after seeding; ERC_CHECK_URL=<site> adds route, REST, player and JSON-LD cases
pnpm --filter @erc/web payload run src/scripts/seed-articles.ts       # the six Learn articles, upserted by slug and left in review for staff to publish
pnpm --filter @erc/web payload run src/scripts/check-articles.ts      # after seeding; the articles are hidden from the public and in review for staff
pnpm --filter @erc/web payload run src/scripts/seed-pages.ts          # placeholder Home, About, Coaching, Contact, published
pnpm --filter @erc/web payload run src/scripts/seed-plans.ts          # placeholder 5K and 10K plans and one PDF, replaced on re-run
pnpm --filter @erc/web payload run src/scripts/check-plans.ts         # after seeding; ERC_CHECK_URL=<site> adds the page and /downloads cases
pnpm --filter @erc/web payload run src/scripts/check-newsletter.ts    # needs ERC_CHECK_URL=<site> and MAILPIT_URL=<mailpit>; the site's SMTP must send to that Mailpit; also checks the hourly email caps
ERC_CHECK_URL=<site> pnpm --filter @erc/web payload run src/scripts/check-athlete-claims.ts   # claims, profile edits, consent, photos; share MEDIA_DIR with the site
pnpm --filter @erc/web payload run src/scripts/check-coaching.ts     # coaching links, check-ins, reviews, and triage
pnpm --filter @erc/web payload run src/scripts/check-intake.ts       # intake consent, sharing with an active coach only, clearing, and deletion with the member
pnpm --filter @erc/web payload run src/scripts/seed-shoes.ts          # ten widely sold running shoes, upserted by slug
ERC_CHECK_URL=<site> pnpm --filter @erc/web payload run src/scripts/check-reviews.ts   # shoe and race reviews, race questions, coach answers, limits, privacy
pnpm --filter @erc/web payload run src/scripts/check-strava.ts       # Strava OAuth, token encryption, 10-cap waitlist, sync, run metrics, job queue drain, webhooks, coach view, disconnect, and privacy isolation
pnpm --filter @erc/web payload run src/scripts/check-google.ts       # Continue with Google: start, callback refusals, account linking, races; Google's token endpoint is stubbed
pnpm --filter @erc/web payload run src/scripts/check-nearest-news.ts  # after seed-races; nearest ordering, home city, news workflow; ERC_CHECK_URL=<site> adds page, API, cache and revalidation cases
ERC_CHECK_URL=<site> pnpm --filter @erc/web payload run src/scripts/check-seo.ts   # after every seed; sitemap, robots.txt, feed and JSON-LD
ERC_CHECK_URL=<site> pnpm --filter @erc/web payload run src/scripts/check-r2.ts    # with the site and the script both given the R2_* variables; any S3-compatible store works
```

Scripts write through the Local API in their own process, so they cannot expire the running site's cache directly. Set `ERC_SITE_URL` and `REVALIDATE_SECRET` in `apps/web/.env` (the server needs the same secret) and they ask the site to do it. In production both are required: the server refuses to start without them. `next start` keeps cached reads in `.next/cache/fetch-cache` across rebuilds; delete that folder after changing the shape a content function returns.
