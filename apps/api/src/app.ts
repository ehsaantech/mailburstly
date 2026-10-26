import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";

import type { AppBindings } from "@/types";
import { AppError } from "@/core/errors";
import { requestId } from "@/middleware/request-id";
import { requestLogger } from "@/middleware/logger";
import { createRootRouter } from "@/routes";
import type { Logger } from "@/core/logger";
import type { DbHandle } from "@/db";
import type { ApiErrorBody } from "@mailrung/shared";
import { allowedOrigins } from "@/env";

/** Route prefix. The web client and nginx both assume it. */
export const API_PREFIX = "/api";

/* -------------------------------------------------------------------------- */
/* Error envelope                                                             */
/* -------------------------------------------------------------------------- */

const errorCodes: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  500: "internal_error",
  501: "not_implemented",
};

const errorMessages: Record<number, string> = {
  400: "Validation failed",
  404: "Route not found",
  409: "That record already exists",
  500: "Internal server error",
  501: "Not built yet",
};

function errorBody(
  status: number,
  requestId: string,
  details?: unknown,
): ApiErrorBody {
  return {
    error: {
      code: errorCodes[status] ?? "internal_error",
      message: errorMessages[status] ?? "Internal server error",
      details,
    },
    requestId,
  };
}

const STATUSES = [400, 401, 403, 404, 409, 500, 501, 503] as const;
type ErrorStatus = (typeof STATUSES)[number];

function isErrorStatus(status: number): status is ErrorStatus {
  return STATUSES.includes(status as ErrorStatus);
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `/health` sits at the root, not under /api, so a container probe stays a
 * single predictable path and never depends on route grouping.
 *
 * It is a **liveness** probe on purpose: a readiness check that flaps 503 when
 * Postgres is briefly unreachable turns a cold start into a restart loop,
 * which makes any incident worse. Readiness lives on `/api/health`, where the
 * router reports database *and* EmailEngine checks.
 */
function createLivenessRoute(db: DbHandle, log: Logger) {
  return async function liveness(c: Context<AppBindings>) {
    try {
      await db.ping();
      return c.json({ status: "ok", version: "0.1.0", uptime: process.uptime() }, 200);
    } catch (error) {
      log.error("liveness: cannot reach postgres", { error: String(error) });
      return c.json({ status: "error", version: "0.1.0" }, 503);
    }
  };
}

/* -------------------------------------------------------------------------- */

export function createApp(options: { log: Logger; db: DbHandle }) {
  const { log, db } = options;
  const app = new Hono<AppBindings>();

  /* Request id first: the logger and every error reference it. */
  app.use("*", requestId);
  app.use("*", requestLogger(log));

  app.use(
    "*",
    cors({
      origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : null),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      maxAge: 86_400,
    }),
  );

  // Liveness for the container. Everything real lives under /api.
  app.get("/health", createLivenessRoute(db, log));
  app.route(API_PREFIX, createRootRouter(db, log));

  /** Registered last, so any real route has already matched by now. */
  app.notFound((c) => {
    const requestId = c.get("requestId") ?? "";
    return c.json(errorBody(404, requestId), 404);
  });

  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? "";

    if (error instanceof AppError) {
      if (error.status >= 500) {
        log.error(error.message, { requestId, status: error.status });
      }

      const status = isErrorStatus(error.status) ? error.status : 500;

      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          requestId,
        },
        status,
      );
    }

    /* Anything not an AppError is a bug: log it loudly, answer carefully. */
    log.error("unhandled error", {
      requestId,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return c.json(errorBody(500, requestId), 500);
  });

  return app;
}