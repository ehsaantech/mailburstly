import { createHmac, randomUUID } from "node:crypto";

import type { Logger } from "@/core/logger";
import {
  createOutboundWebhookRepository,
  type OutboundWebhookRepository,
} from "./repository";

export interface WebhookServiceDeps {
  db: { db: Parameters<typeof createOutboundWebhookRepository>[0]["db"] };
  log: Logger;
  /** How long to wait for the receiver. */
  timeoutMs?: number;
}

export function createWebhookService(deps: WebhookServiceDeps) {
  const repo: OutboundWebhookRepository = createOutboundWebhookRepository({
    db: deps.db.db,
  });
  const { log } = deps;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  /**
   * Delivers one event to every webhook that asked for it.
   *
   * Delivery is at-least-once: a receiver that answers 500 gets the event
   * again next time. Receivers are expected to be idempotent, and every
   * payload carries a stable event id so they can be.
   */
  const deliver = async (
    workspaceId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const targets = await repo.activeForEvent(workspaceId, event);
    if (targets.length === 0) return;

    for (const hook of targets) {
      const body = {
        id: randomUUID(),
        event,
        createdAt: new Date().toISOString(),
        data: payload,
      };

      const delivery = await repo.recordDelivery({
        webhookId: hook.id,
        event,
        payload: body,
      });

      const signature = createHmac("sha256", hook.secret)
        .update(JSON.stringify(body))
        .digest("hex");

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Mailrung-Event": event,
            "X-Mailrung-Signature": `sha256=${signature}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.ok) {
          await repo.markDelivered(delivery.id, response.status);
          await repo.touchWebhook(hook.id);
        } else {
          await repo.markFailed(
            delivery.id,
            response.status,
            `receiver answered ${response.status}`,
          );
          log.warn("webhook delivery failed", {
            webhookId: hook.id,
            status: response.status,
          });
        }
      } catch (error) {
        await repo.markFailed(
          delivery.id,
          null,
          error instanceof Error ? error.message : String(error),
        );
        log.warn("webhook delivery errored", {
          webhookId: hook.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  return {
    deliver,
    recentDeliveries: (workspaceId: string, limit?: number) =>
      repo.recentDeliveries(workspaceId, limit),
    pendingActivityTypes: (workspaceId: string) =>
      repo.pendingActivityTypes(workspaceId),
  };
}

export type WebhookService = ReturnType<typeof createWebhookService>;
