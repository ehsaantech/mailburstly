import { Hono } from "hono";

import { created, noContent, ok, paginated } from "@/core/response";
import { parseJson, parseParams, parseQuery } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { LeadService } from "./service";
import {
  createLeadSchema,
  importLeadsSchema,
  leadParamsSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from "./validator";

export function createLeadRoutes(leads: LeadService, requireAuth: AppMiddleware) {
  // NOTE: static segments must be registered before "/:id", otherwise
  // "/labels" and "/import" are captured by the uuid param and 400.
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    const query = parseQuery(c, listLeadsQuerySchema);
    const { items, total } = await leads.list(query);
    return paginated(c, items, query.offset + items.length < total ? String(query.offset + items.length) : null);
  });

  routes.post("/", async (c) => {
    const input = await parseJson(c, createLeadSchema);
    return created(c, { lead: await leads.create(input) });
  });

  routes.get("/labels", async (c) => {
    return ok(c, { items: await leads.listLabels() });
  });

  routes.post("/import", async (c) => {
    const input = await parseJson(c, importLeadsSchema);
    const result = await leads.importLeads(input);
    return ok(c, result);
  });

  routes.get("/:id", async (c) => {
    const { id } = parseParams(c, leadParamsSchema);
    return ok(c, { lead: await leads.get(id) });
  });

  routes.patch("/:id", async (c) => {
    const { id } = parseParams(c, leadParamsSchema);
    const patch = await parseJson(c, updateLeadSchema);
    return ok(c, { lead: await leads.update(id, patch) });
  });

  routes.delete("/:id", async (c) => {
    const { id } = parseParams(c, leadParamsSchema);
    await leads.remove(id);
    return noContent(c);
  });

  return routes;
}