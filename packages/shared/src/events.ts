/**
 * Event names emitted to outbound webhooks and pushed over the realtime socket.
 * One list so api, worker and web cannot drift.
 */
export const WEBHOOK_EVENTS = [
  "campaign.created",
  "campaign.launched",
  "campaign.paused",
  "campaign.completed",
  "email.sent",
  "email.bounced",
  "email.opened",
  "link.clicked",
  "reply.received",
  "lead.created",
  "lead.invalid",
  "lead.status_changed",
  "opportunity.created",
  "opportunity.won",
  "mailbox.unhealthy",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const REALTIME_CHANNELS = [
  "activities",
  "inbox",
  "campaign",
  "mailbox",
] as const;

export type RealtimeChannel = (typeof REALTIME_CHANNELS)[number];

export interface WebhookEnvelope<T = unknown> {
  /** Monotonic id. Consumers dedupe on this. */
  id: string;
  event: WebhookEvent;
  createdAt: string;
  workspaceId: string;
  data: T;
}

export interface RealtimeMessage<T = unknown> {
  channel: RealtimeChannel;
  action: "created" | "updated" | "deleted";
  data: T;
}
