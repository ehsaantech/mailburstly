# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build the React SPA, then serve it from nginx which also reverse-proxies
# /api and /ws to the Hono api container.
# ---------------------------------------------------------------------------

FROM oven/bun:1.4-alpine AS build
WORKDIR /app

# Build-time config. VITE_* values are inlined into the bundle at build time,
# so they are build args, not runtime env.
ARG VITE_API_URL=/api
ARG VITE_WS_URL=/ws
ARG VITE_USE_MOCKS=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_USE_MOCKS=$VITE_USE_MOCKS

# Workspace manifests first, so dependency layers cache independently of source.
COPY package.json bun.lock* ./
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile || bun install

COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN bun run build

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
RUN rm /etc/nginx/conf.d/default.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --spider -q http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
