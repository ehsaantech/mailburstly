import { Hono } from "hono";

import { created, noContent, ok, paginated } from "@/core/response";
import { parseJson, parseParams, parseQuery } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { ListService } from "./service";
import {
  addMembersSchema,
  attachToCampaignSchema,
  createListSchema,
  listMemberParamsSchema,
  listCampaignParamsSchema,
  listMembersQuerySchema,
  listParamsSchema,
  updateListSchema,
} from "./validator";

export function createListRoutes(lists: ListService, requireAuth: AppMiddleware) {
  // NOTE: static segments must be registered before "/:id".
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    return ok(c, { items: await lists.list() });
  });

  routes.post("/", async (c) => {
    const input = await parseJson(c, createListSchema);
    return created(c, { list: await lists.create(input) });
  });

  routes.get("/:id", async (c) => {
    const { id } = parseParams(c, listParamsSchema);
    return ok(c, { list: await lists.get(id) });
  });

  routes.patch("/:id", async (c) => {
    const { id } = parseParams(c, listParamsSchema);
    const input = await parseJson(c, updateListSchema);
    return ok(c, { list: await lists.update(id, input) });
  });

  routes.delete("/:id", async (c) => {
    const { id } = parseParams(c, listParamsSchema);
    await lists.remove(id);
    return noContent(c);
  });

  routes.post("/:id/duplicate", async (c) => {
    const { id } = parseParams(c, listParamsSchema);
    return created(c, { list: await lists.duplicate(id) });
  });

  /* ------------------------------ members ------------------------------ */

  routes.get("/:id/members", async (c) => {
    const { id } = parseParams(c, listParamsSchema);
    const query = parseQuery(c, listMembersQuerySchema);
    const { items, total } = await lists.members(id, query);
    return paginated(
      c,
      items,
      query.offset + items.length < total ? String(query.offset + items.length) : null,
    );
  });

  routes.post("/:id/members", async (c) => {
    const { id } = parseParams(c, listParamsSchema);
    const input = await parseJson(c, addMembersSchema);
    return created(c, await lists.addMembers(id, input));
  });

  routes.delete("/:id/members/:leadId", async (c) => {
    const { id, leadId } = parseParams(c, listMemberParamsSchema);
    await lists.removeMember(id, leadId);
    return noContent(c);
  });

  /* ------------------------ campaign attachment ----------------------- */

  routes.post("/:id/campaigns", async (c) => {
    const { id } = parseParams(c, listParamsSchema);
    const input = await parseJson(c, attachToCampaignSchema);
    return created(c, await lists.attachToCampaign(id, input));
  });

  routes.delete("/:id/campaigns/:campaignId", async (c) => {
    const { id, campaignId } = parseParams(c, listCampaignParamsSchema);
    await lists.detachFromCampaign(id, campaignId);
    return noContent(c);
  });

  return routes;
}
