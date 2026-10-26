/**
 * Entry point.
 *
 * Bun serves the Hono app directly — no build step, `bun src/start.ts` is the
 * whole deployment story. Graceful shutdown is handled explicitly so the
 * Postgres pool drains rather than being killed mid-query.
 */

import { createApp } from "./app";
import { createLogger } from "./core/logger";
import { createDb } from "./db";
import { env } from "./env";

const log = createLogger(env.LOG_LEVEL, { service: "api", env: env.NODE_ENV });

const db = createDb(env.DATABASE_URL, { max: 20 });

const app = createApp({ log, db });

console.log(`api booting — db=${db.digest}`);

const server = Bun.serve({
  port: env.API_PORT,
  // `app.fetch` is the whole integration surface; nothing else touches the
  // runtime, which keeps the handler testable without a socket.
  fetch: app.fetch,
});

log.info("api listening", {
  port: server.port,
  db: db.digest,
  routes: ["/health", "/auth/*", "/mailboxes/*", "/workspace/*"],
});

async function shutdown(signal: string) {
  log.info("shutting down", { signal });
  try {
    server.stop(true);
    await db.close();
  } catch (error) {
    log.error("shutdown error", { error: String(error) });
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));