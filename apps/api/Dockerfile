# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Bun runtime, no build step: tsc --noEmit for types, bun runs the source.
# ---------------------------------------------------------------------------

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Workspace manifests first so dependency layers cache independently.
COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN bun install --frozen-lockfile || bun install

# Shared packages and application source.
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

WORKDIR /app/apps/api

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD wget --spider -q http://localhost:3001/health || exit 1

CMD ["bun", "src/index.ts"]