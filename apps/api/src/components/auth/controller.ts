import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { AppBindings, AppMiddleware } from "@/types";
import { fromPostgresError } from "@/core/errors";
import { noContent, ok } from "@/core/response";
import { parseJson } from "@/core/validate";
import { SESSION_COOKIE } from "@/middleware/auth";
import { env } from "@/env";
import type { AuthService } from "./service";
import { loginSchema } from "./validator";

/**
 * Controller — HTTP surface only: request parsing and cookie plumbing.
 *
 * `/login` and `/logout` are public. `/me` takes `requireAuth` as per-route
 * middleware, which is the narrowest way to protect a single route.
 */
export function createAuthRoutes(
  auth: AuthService,
  requireAuth: AppMiddleware,
  ttlSeconds: number,
) {
  const routes = new Hono<AppBindings>();

  routes.post("/login", async (c) => {
    const input = await parseJson(c, loginSchema);

    let result;
    try {
      result = await auth.login(input);
    } catch (error) {
      // A Postgres failure mid-login is the only non-AppError path here.
      throw error instanceof Error && error.name === "AppError"
        ? error
        : fromPostgresError(error);
    }

    setCookie(c, SESSION_COOKIE, result.token, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: env.NODE_ENV === "production",
      maxAge: ttlSeconds,
    });

    return ok(c, { user: result.user, expiresAt: result.session.expiresAt });
  });

  routes.post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await auth.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return noContent(c);
  });

  routes.get("/me", requireAuth, (c) => ok(c, { user: c.get("user") }));

  return routes;
}