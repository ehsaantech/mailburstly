# syntax=docker/dockerfile:1

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN bun install --frozen-lockfile || bun install

COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

WORKDIR /app/apps/worker

EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD wget --spider -q http://localhost:3002/health || exit 1

CMD ["bun", "src/index.ts"]