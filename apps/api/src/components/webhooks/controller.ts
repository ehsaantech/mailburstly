import { Hono } from "hono";

import { created, noContent, ok } from "@/core/response";
import { parseJson, parseParams, parseQuery } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { WebhookService } from "./service";
import {
  apiKeyParamsSchema,
  createApiKeySchema,
  createWebhookSchema,
  deliveriesQuerySchema,
  updateWebhookSchema,
  webhookParamsSchema,
} from "./validator";

export function createWebhookRoutes(
  webhooks: WebhookService,
  requireAuth: AppMiddleware,
) {
  // NOTE: static segments must be registered before "/:id".
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    return ok(c, { items: await webhooks.list() });
  });

  routes.post("/", async (c) => {
    const input = await parseJson(c, createWebhookSchema);
    return created(c, { webhook: await webhooks.create(input) });
  });

  routes.get("/deliveries", async (c) => {
    const query = parseQuery(c, deliveriesQuerySchema);
    return ok(c, { items: await webhooks.deliveries(query) });
  });

  routes.get("/api-keys", async (c) => {
    return ok(c, { items: await webhooks.listApiKeys() });
  });

  routes.post("/api-keys", async (c) => {
    const input = await parseJson(c, createApiKeySchema);
    return created(c, { apiKey: await webhooks.createApiKey(input) });
  });

  routes.delete("/api-keys/:id", async (c) => {
    const { id } = parseParams(c, apiKeyParamsSchema);
    await webhooks.revokeApiKey(id);
    return noContent(c);
  });

  routes.get("/:id", async (c) => {
    const { id } = parseParams(c, webhookParamsSchema);
    return ok(c, { webhook: await webhooks.get(id) });
  });

  routes.patch("/:id", async (c) => {
    const { id } = parseParams(c, webhookParamsSchema);
    const input = await parseJson(c, updateWebhookSchema);
    return ok(c, { webhook: await webhooks.update(id, input) });
  });

  routes.delete("/:id", async (c) => {
    const { id } = parseParams(c, webhookParamsSchema);
    await webhooks.remove(id);
    return noContent(c);
  });

  return routes;
}
