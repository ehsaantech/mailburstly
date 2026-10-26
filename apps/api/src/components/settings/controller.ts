import { Hono } from "hono";

import { ok } from "@/core/response";
import { parseJson } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { SettingsService } from "./service";
import { updateSettingsSchema } from "./validator";

export function createSettingsRoutes(
  settings: SettingsService,
  requireAuth: AppMiddleware,
) {
  // NOTE: static segments must be registered before "/:id".
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    return ok(c, { settings: await settings.get() });
  });

  routes.get("/llm-models", async (c) => {
    return ok(c, { items: await settings.listModels() });
  });

  routes.patch("/", async (c) => {
    const input = await parseJson(c, updateSettingsSchema);
    return ok(c, { settings: await settings.update(input) });
  });

  return routes;
}
