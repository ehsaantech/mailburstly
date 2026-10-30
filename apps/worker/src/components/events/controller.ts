import type { Context } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { AppContext } from "@/app";
import type { Logger } from "@/core/logger";
import { raiseAlert } from "@/lib/alerts";
import type { EventsService } from "./service";
import type { MailcoreEvent } from "./types";

export interface EventsControllerDeps {
  service: EventsService;
  log: Logger;
  /**
   * The mailcore `serviceSecret`. When set, the request signature is
   * verified; when unset, the endpoint accepts anything. Verification is
   * only optional because a self-hosted mailcore behind a private network
   * is a legitimate deployment.
   */
  secret?: string;
}

/**
 * Verifies mailcore's HMAC-SHA256 signature over the raw body.
 *
 * The signature travels in `X-EE-Wh-Signature` and is base64url encoded.
 * The comparison is constant-time so the check cannot be used as an oracle.
 */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64url");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The mailcore webhook receiver.
 *
 * mailcore retries a failed delivery up to ten times, so the handler is
 * written to be safe to run twice. It acknowledges before it does the work:
 * a slow handler turns one event into ten deliveries.
 */
export function createEventsController(deps: EventsControllerDeps) {
  const { service, log, secret } = deps;

  return async function handleWebhook(c: AppContext): Promise<Response> {
    const rawBody = await c.req.text();

    if (secret) {
      const signature = c.req.header("x-ee-wh-signature") ?? null;
      if (!verifySignature(rawBody, signature, secret)) {
        log.warn("webhook signature verification failed", {
          eventId: c.req.header("x-ee-wh-event-id") ?? null,
        });
        return c.json({ ok: false, error: "invalid signature" }, 401);
      }
    }

    let event: MailcoreEvent;
    try {
      event = JSON.parse(rawBody) as MailcoreEvent;
    } catch {
      log.warn("webhook body was not valid JSON");
      return c.json({ ok: false, error: "invalid json" }, 400);
    }

    const eventId = c.req.header("x-ee-wh-event-id") ?? null;

    // Acknowledge first. The work happens after the response, and every
    // step of it is idempotent.
    const response = c.json({ ok: true, event: event.event ?? "unknown" }, 202);

    try {
      await service.handle(event, eventId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      log.error("webhook processing failed", {
        eventId,
        event: event.event ?? null,
        error: detail,
      });

      void raiseAlert({
        key: "worker.webhook_processing_failed",
        title: "A mail gateway webhook could not be processed",
        message: detail,
        severity: "error",
        service: "worker",
        context: { eventId, event: event.event ?? null, error: detail },
      });
    }

    return response;
  };
}

export type EventsController = ReturnType<typeof createEventsController>;
export type { Context };
