# ERC

Website for ERC: race calendar, training plans, learning centre, and athlete profiles. Design: [docs/20261019-erc-phase-1-design.md](docs/20261019-erc-phase-1-design.md).

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
pnpm --filter @erc/web payload run src/scripts/check-record-access.ts
pnpm --filter @erc/web payload run src/scripts/check-write-rules.ts     # ERC_CHECK_URL=<site> adds the REST cases
pnpm --filter @erc/web payload run src/scripts/check-race-hook.ts
pnpm --filter @erc/web payload run src/scripts/seed-races.ts          # 3,000 synthetic races, replaced on re-run
pnpm --filter @erc/web payload run src/scripts/check-race-calendar.ts # after seeding
pnpm --filter @erc/web payload run src/scripts/check-revalidation.ts  # with the site running
```

Scripts write through the Local API in their own process, so they cannot expire the running site's cache directly. Set `ERC_SITE_URL` and `REVALIDATE_SECRET` in `apps/web/.env` (the server needs the same secret) and they ask the site to do it. In production both are required: the server refuses to start without them. `next start` keeps cached reads in `.next/cache/fetch-cache` across rebuilds; delete that folder after changing the shape a content function returns.
