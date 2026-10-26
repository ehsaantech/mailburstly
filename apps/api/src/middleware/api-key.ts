import type { MiddlewareHandler } from "hono";

import { unauthorized } from "@/core/errors";
import type { AppBindings } from "@/types";
import type { WebhookService } from "@/components/webhooks/service";

export interface ApiKeyAuthDeps {
  webhooks: WebhookService;
}

/**
 * Authenticates a request with an api key.
 *
 * The key is presented as `Authorization: Bearer <key>`. It is looked up by
 * hash — the raw key is never stored — and the resolved workspace id is put
 * on the context so the handlers scope their queries to it.
 */
export function createApiKeyAuth(deps: ApiKeyAuthDeps) {
  return async function apiKeyAuth(
    c: Parameters<MiddlewareHandler<AppBindings>>[0],
    next: Parameters<MiddlewareHandler<AppBindings>>[1],
  ) {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());

    if (!match) {
      throw unauthorized("An api key is required");
    }

    const key = await deps.webhooks.resolveApiKey(match[1]!.trim());
    if (!key) {
      throw unauthorized("That api key is not valid");
    }

    c.set("apiKeyWorkspaceId", key.workspaceId);
    await next();
  };
}
