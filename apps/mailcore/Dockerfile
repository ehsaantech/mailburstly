# syntax=docker/dockerfile:1
#
# mailcore — the mail gateway.
#
# The mail protocol work is done by the same MIT libraries the old engine used
# built on: imapflow (IMAP), nodemailer (SMTP), mailparser (MIME).

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY apps/mailcore/package.json ./apps/mailcore/package.json
RUN bun install --frozen-lockfile || bun install

COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/mailcore ./apps/mailcore

WORKDIR /app/apps/mailcore

EXPOSE 3004
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD wget --spider -q http://localhost:3004/health || exit 1

CMD ["bun", "src/index.ts"]
