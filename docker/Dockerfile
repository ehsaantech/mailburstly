# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# The edge image: Caddy, serving the built React SPA and proxying /api, /ws
# and the mailcore paths.
#
# The SPA is baked in rather than served by a second container, so there is
# one proxy in the stack and one config file (docker/Caddyfile) that decides
# what every path means.
# ---------------------------------------------------------------------------

FROM oven/bun:1.4-alpine AS web-build
WORKDIR /app

# Build-time config. VITE_* values are inlined into the bundle at build time,
# so they are build args, not runtime env.
ARG VITE_API_URL=/api
ARG VITE_WS_URL=/ws
ARG VITE_USE_MOCKS=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_USE_MOCKS=$VITE_USE_MOCKS

# Google's site-verification token. Not a secret: it is public on the home
# page. Empty means "no token" and the tag is left out.
ARG GOOGLE_SITE_VERIFICATION=
ENV GOOGLE_SITE_VERIFICATION=$GOOGLE_SITE_VERIFICATION

# Workspace manifests first, so dependency layers cache independently of source.
COPY package.json bun.lock* ./
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile || bun install

COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN bun run build
# The verification tag goes into the built HTML, so it runs after the build.
RUN bun run inject:verification

# ---------------------------------------------------------------------------
FROM caddy:2-alpine AS runtime

# The SPA, served from disk.
COPY --from=web-build /app/apps/web/dist /srv

# The routing. It ships inside the image, so a deploy picks up a changed
# Caddyfile with the rebuild that deploys the rest of the stack.
COPY docker/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443

# Liveness of the proxy. The admin API answers on localhost only, so this
# works the same whether the site address is a domain or plain HTTP.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2019/metrics >/dev/null 2>&1 || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
