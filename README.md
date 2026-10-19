# ERC

Website for ERC: race calendar, training plans, learning centre, and athlete profiles. Design: [docs/20261019-erc-phase-1-design.md](docs/20261019-erc-phase-1-design.md).

## Layout

- `apps/web`: Next.js and Payload CMS (public site, `/admin`, API)
- `packages/domain`: framework-free domain types and rules, shared by every app
- `packages/tsconfig`: shared TypeScript settings
- `infra/boxy`: Docker Compose deployment for the server

## Commands

```sh
pnpm install
pnpm typecheck
pnpm build
docker build -f apps/web/Dockerfile -t erc-web .
```

Copy `apps/web/.env.example` to `apps/web/.env` for local work.
