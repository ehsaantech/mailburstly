import type { Next } from "hono";

import type { AppContext } from "@/types";
import type { Logger } from "@/core/logger";

/**
 * One log line per request: method, path, status, duration, request id.
 * Emitted after the handler returns so the status is final.
 */
export function requestLogger(log: Logger) {
  return async (c: AppContext, next: Next) => {
    const started = performance.now();
    await next();
    const durationMs = Math.round((performance.now() - started) * 100) / 100;

    log.info(`${c.req.method} ${c.req.path}`, {
      requestId: c.get("requestId"),
      status: c.res.status,
      durationMs,
    });
  };
}