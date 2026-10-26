/**
 * Component layering for the worker.
 *
 * Same convention as the api:
 *
 *   component/
 *     controller.ts   — HTTP surface (webhook handlers, if any)
 *     service.ts      — business logic
 *     repository.ts    — db layer (SQL)
 *
 * The worker has no request/response contract of its own, but the HTTP
 * webhook receiver still benefits from the same separation: the controller
 * parses the payload, the service decides what to do, the repository writes
 * the rows.
 */

/* Health probe — no service or repository; it is a liveness check. */
export * from "./components/health/controller";

/* Scheduler — decides which leads are due for their next step. */
export * from "./components/scheduler/controller";
export * from "./components/scheduler/service";
export * from "./components/scheduler/repository";

/* Events — the EmailEngine webhook receiver and its pipeline. */
export * from "./components/events/controller";
export * from "./components/events/service";
export * from "./components/events/repository";
export * from "./components/events/types";
export * from "./components/events/classify";

/* Reply intake — attributes inbound mail to a lead + campaign. */
export * from "./components/reply-intake/controller";
export * from "./components/reply-intake/service";
export * from "./components/reply-intake/repository";

/* Classification — AI reply tagging. */
export * from "./components/classification/service";
export * from "./components/classification/ollama";
export * from "./components/classification/types";

/* Verification — email verification provider calls. */
export * from "./components/verification/service";

/* Webhook delivery — outbound webhooks with retries. */
export * from "./components/webhooks/service";
export * from "./components/webhooks/repository";

/* Aggregation — roll up activities into daily stats. */
export * from "./components/aggregation/service";

/* Auto-pause — pause a campaign whose metrics have gone bad. */
export * from "./components/auto-pause/service";
export * from "./components/auto-pause/repository";

/* Scheduled replies — send the replies the operator queued for later. */
export * from "./components/scheduled-replies/service";
export * from "./components/scheduled-replies/repository";