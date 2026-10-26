import { Hono } from "hono";
import { z } from "zod";

import { ok, paginated } from "@/core/response";
import { parseQuery } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { PublicApiService } from "./service";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const leadQuerySchema = listQuerySchema.extend({
  statusId: z.coerce.number().int().optional(),
  search: z.string().trim().max(200).optional(),
});

/**
 * The public API.
 *
 * Authenticated with an api key rather than a session, so another system can
 * read the same numbers the dashboard shows. It is deliberately read-only:
 * anything that sends mail stays behind the session-authenticated api.
 */
export function createPublicApiRoutes(
  publicApi: PublicApiService,
  apiKeyAuth: AppMiddleware,
) {
  const routes = new Hono<AppBindings>();
  routes.use("*", apiKeyAuth);

  routes.get("/campaigns", async (c) => {
    const query = parseQuery(c, listQuerySchema);
    const { items, total } = await publicApi.campaigns(
      c.get("apiKeyWorkspaceId"),
      query.limit,
      query.offset,
    );
    return paginated(
      c,
      items,
      query.offset + items.length < total ? String(query.offset + items.length) : null,
    );
  });

  routes.get("/leads", async (c) => {
    const query = parseQuery(c, leadQuerySchema);
    const { items, total } = await publicApi.leads(
      c.get("apiKeyWorkspaceId"),
      query,
    );
    return paginated(
      c,
      items,
      query.offset + items.length < total ? String(query.offset + items.length) : null,
    );
  });

  routes.get("/leads/:id/campaigns", async (c) => {
    const items = await publicApi.leadCampaigns(
      c.get("apiKeyWorkspaceId"),
      c.req.param("id"),
    );
    return ok(c, { items });
  });

  return routes;
}
