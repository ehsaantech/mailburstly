import { Hono } from "hono";

import { created, noContent, ok } from "@/core/response";
import { parseJson, parseParams } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { AlertRecipientsService } from "./service";
import {
  alertRecipientParamsSchema,
  createAlertRecipientSchema,
  updateAlertRecipientSchema,
} from "./validator";

export function createAlertRecipientRoutes(
  recipients: AlertRecipientsService,
  requireAuth: AppMiddleware,
) {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    return ok(c, { items: await recipients.list() });
  });

  routes.post("/", async (c) => {
    const input = await parseJson(c, createAlertRecipientSchema);
    return created(c, { recipient: await recipients.create(input) });
  });

  routes.get("/:id", async (c) => {
    const { id } = parseParams(c, alertRecipientParamsSchema);
    return ok(c, { recipient: await recipients.get(id) });
  });

  routes.patch("/:id", async (c) => {
    const { id } = parseParams(c, alertRecipientParamsSchema);
    const input = await parseJson(c, updateAlertRecipientSchema);
    return ok(c, { recipient: await recipients.update(id, input) });
  });

  routes.delete("/:id", async (c) => {
    const { id } = parseParams(c, alertRecipientParamsSchema);
    await recipients.remove(id);
    return noContent(c);
  });

  /** Sends a test alert to this one address. */
  routes.post("/:id/test", async (c) => {
    const { id } = parseParams(c, alertRecipientParamsSchema);
    return ok(c, await recipients.test(id));
  });

  return routes;
}
