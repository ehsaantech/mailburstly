import type { Context } from "hono";

import type { AuthUser, SessionRecord } from "@mailrung/shared";

/**
 * Shared Hono typing.
 *
 * `AppBindings` is the `Env` passed to `new Hono<AppBindings>()`. Because the
 * variables are declared here, `c.get("user")` returns an `AuthUser` in every
 * handler instead of `unknown`.
 */
export interface AppBindings {
  Variables: {
    requestId: string;
    /** Present once `requireAuth` has run. Handlers after it may read directly. */
    user: AuthUser;
    session: SessionRecord;
    /**
     * The workspace the api key belongs to. Present only on the public api,
     * where the key — not a session — decides the scope.
     */
    apiKeyWorkspaceId: string;
  };
}

/** A fully-typed request context. */
export type AppContext = Context<AppBindings>;

/** Signature of an injected auth middleware, for controllers. */
export type AppMiddleware = (c: AppContext, next: () => Promise<void>) => Promise<void>;

export type { AuthUser, SessionRecord };