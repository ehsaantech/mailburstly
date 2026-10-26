import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Postgres enums — the single source of truth for state machine values.
 * The TS unions in @mailrung/shared mirror these exactly.
 */

export const userRoleEnum = pgEnum("user_role", ["admin", "member"]);

export const mailboxProviderEnum = pgEnum("mailbox_provider", [
  "google",
  "microsoft",
  "imap_smtp",
]);

export const mailboxStatusEnum = pgEnum("mailbox_status", [
  "connected",
  "degraded",
  "failed",
  "disconnected",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "completed",
]);

export const campaignStateEnum = pgEnum("campaign_state", [
  "active",
  "stopped",
  "completed",
  "suppressed",
  "paused",
]);

export const leadEmailStatusEnum = pgEnum("lead_email_status", [
  "unknown",
  "valid",
  "invalid",
  "risky",
  "catch_all",
]);

export const interestEnum = pgEnum("interest", [
  "positive",
  "neutral",
  "negative",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "email_sent",
  "email_opened",
  "link_clicked",
  "reply_received",
  "auto_reply",
  "bounced",
  "unsubscribed",
  "status_changed",
  "subsequence_entered",
]);

export const blocklistTypeEnum = pgEnum("blocklist_type", ["email", "domain"]);

export const blocklistSourceEnum = pgEnum("blocklist_source", [
  "manual",
  "hard_bounce",
  "unsubscribe",
  "complaint",
  "ai_blocklist",
]);

export const sendJobStateEnum = pgEnum("send_job_state", [
  "pending",
  "claimed",
  "sent",
  "soft_bounced",
  "hard_bounced",
  "failed",
  "skipped",
]);

export const threadModeEnum = pgEnum("thread_mode", ["reply", "new_thread"]);

/* -------------------------------------------------------------------------- */
/* Inbox                                                                      */
/* -------------------------------------------------------------------------- */

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "closed",
  "archived",
]);

export const opportunityStatusEnum = pgEnum("opportunity_status", [
  "open",
  "won",
  "lost",
]);

/**
 * How a reply was classified. `ai` covers anything the classifier produced;
 * the explicit values are for replies we can recognise structurally (an
 * out-of-office bounce, an unsubscribe confirmation).
 */
export const classificationEnum = pgEnum("classification", [
  "unclassified",
  "positive",
  "negative",
  "neutral",
  "question",
  "out_of_office",
  "unsubscribe",
  "bounce",
  "other",
]);

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

export const subsequenceTriggerEnum = pgEnum("subsequence_trigger", [
  "reply",
  "reply_keyword",
  "status_change",
  "bounce",
  "manual",
]);
