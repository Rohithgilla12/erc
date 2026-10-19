# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat && corepack enable

FROM base AS pruner
WORKDIR /repo
COPY . .
# Keeps only @erc/web and the workspace packages it depends on, so a mobile app change never busts this image's cache.
RUN corepack pnpm dlx turbo@2.11.9 prune @erc/web --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@erc/web

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone output leaves out public/, so static brand assets would 404 without this.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
