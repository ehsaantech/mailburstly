import { Hono } from "hono";
import type { Context, Next } from "hono";

import { ok } from "@/core/response";
import type { AppBindings } from "@/types";
import type { WorkspaceRepository } from "./repository";

/**
 * The injected-auth-middleware signature every domain controller accepts.
 *
 * Declared here and re-exported from @/types so that controllers do not each
 * reinvent it, and so the middleware can be swapped in tests.
 */
export type AppMiddleware = (c: Context<AppBindings>, next: Next) => Promise<void>;

export function createWorkspaceRoutes(
  repository: WorkspaceRepository,
  requireAuth: AppMiddleware,
) {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/current", async (c) => {
    const workspace = await repository.primary();
    return ok(c, { workspace, user: c.get("user") });
  });

  routes.get("/members", async (c) => {
    return ok(c, { items: await repository.members() });
  });

  return routes;
}