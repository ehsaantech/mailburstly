/**
 * Session middleware, built by injection.
 *
 * Dependencies flow through `routes.ts`, where the auth service is created.
 * This file owns cookie plumbing and the throw-on-fail gate only.
 */
import { getCookie } from "hono/cookie";
import type { Next } from "hono";

import type { AppContext } from "@/types";
import { forbidden, unauthorized } from "@/core/errors";
import type { AuthUser } from "@mailrung/shared";

export const SESSION_COOKIE = "mailrung_session";

export interface AuthServiceLike {
  authenticate(
    token: string,
  ): Promise<{
    user: AuthUser;
    session: { id: string; userId: string; expiresAt: string };
  } | null>;
}

/**
 * Resolve the session cookie into a user, or throw 401.
 *
 * A throw-on-fail gate rather than a boolean check keeps handlers free of
 * null-handling: after this middleware runs, `c.get("user")` is populated.
 */
export function createRequireAuth(auth: AuthServiceLike) {
  return async function requireAuth(c: AppContext, next: Next) {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw unauthorized("Missing session cookie");

    const result = await auth.authenticate(token);
    if (!result) {
      // Clear the dead cookie so the next request does not repeat the lookup.
      c.header(
        "set-cookie",
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      throw unauthorized("Session expired or invalid");
    }

    c.set("user", result.user);
    c.set("session", result.session);

    await next();
  };
}

/** Gate a route to a role. Must run after `requireAuth`. */
export function requireRole(role: "admin") {
  return async function (c: AppContext, next: Next) {
    const user = c.get("user");
    if (user?.role !== role) {
      throw forbidden(`Requires the ${role} role`);
    }
    await next();
  };
}

/** Cookie attributes for the auth controller, derived from its dependencies. */
export const sessionCookieOptions = (ttlSeconds: number, secure: boolean) =>
  ({
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: ttlSeconds,
  }) as const;