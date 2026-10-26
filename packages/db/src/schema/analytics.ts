import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  activityTypeEnum,
  webhookDeliveryStatusEnum,
} from "./enums";
import {
  campaigns,
  campaignLeads,
  campaignSteps,
  campaignSubsequences,
  stepVariants,
} from "./campaigns";
import { leads } from "./leads";
import { mailboxes, workspaces } from "./core";

/**
 * The append-only activity log. Every meaningful thing that happens to a
 * lead is written here: a send, an open, a click, a reply, a bounce, a status
 * change. Analytics are aggregated from this table.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "cascade",
    }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, {
      onDelete: "set null",
    }),
    stepId: uuid("step_id").references(() => campaignSteps.id, {
      onDelete: "set null",
    }),
    variantId: uuid("variant_id").references(() => stepVariants.id, {
      onDelete: "set null",
    }),
    type: activityTypeEnum("type").notNull(),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activities_campaign_idx").on(t.campaignId),
    index("activities_lead_idx").on(t.leadId),
    index("activities_type_idx").on(t.type),
    index("activities_created_idx").on(t.createdAt),
  ],
);

/**
 * Daily rollup per campaign. Written by the aggregation job so the dashboard
 * never scans the raw activity log.
 *
 * `stepId`/`variantId` are nullable: a null means "the campaign total", a
 * set value means "this step" or "this variant". The unique index covers all
 * three shapes.
 */
export const campaignDailyStats = pgTable(
  "campaign_daily_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => campaignSteps.id, {
      onDelete: "cascade",
    }),
    variantId: uuid("variant_id").references(() => stepVariants.id, {
      onDelete: "cascade",
    }),
    /** Calendar date in the workspace timezone, as YYYY-MM-DD. */
    date: text("date").notNull(),
    sent: integer("sent").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    opened: integer("opened").notNull().default(0),
    clicked: integer("clicked").notNull().default(0),
    replied: integer("replied").notNull().default(0),
    autoReplied: integer("auto_replied").notNull().default(0),
    bounced: integer("bounced").notNull().default(0),
    unsubscribed: integer("unsubscribed").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_daily_stats_scope_idx").on(
      t.campaignId,
      t.stepId,
      t.variantId,
      t.date,
    ),
    index("campaign_daily_stats_date_idx").on(t.date),
  ],
);

/**
 * Outbound webhooks the team configures. The `events` array lists the
 * activity types that trigger a delivery; an empty array means "everything".
 */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** HMAC secret used to sign the payload. Stored so it can be shown once. */
    secret: text("secret").notNull(),
    events: jsonb("events").notNull().default([]),
    active: integer("active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  },
  (t) => [index("webhooks_workspace_idx").on(t.workspaceId)],
);

/** One attempt to deliver an event to a webhook. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    statusCode: integer("status_code"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_webhook_idx").on(t.webhookId),
    index("webhook_deliveries_status_idx").on(t.status),
  ],
);

/**
 * API keys for the public API. Only a hash is stored — the raw key is shown
 * once at creation and never again.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First few characters, so a key can be recognised in a list. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    index("api_keys_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * What we sent, keyed by the provider's Message-ID.
 *
 * This is the join key for everything that comes back later: a bounce, a
 * complaint, an unsubscribe. EmailEngine does not use VERP, so the Message-ID
 * is the only reliable link between a send and its consequences. Without this
 * table a bounce cannot be attributed to a lead.
 */
export const sentMessages = pgTable(
  "sent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    /** The Message-ID EmailEngine knows the message by. */
    messageId: text("message_id").notNull(),
    /** The Message-ID we submitted, when the provider rewrote it. */
    originalMessageId: text("original_message_id"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, {
      onDelete: "set null",
    }),
    stepId: uuid("step_id").references(() => campaignSteps.id, {
      onDelete: "set null",
    }),
    variantId: uuid("variant_id").references(() => stepVariants.id, {
      onDelete: "set null",
    }),
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sent_messages_message_id_idx").on(t.messageId),
    index("sent_messages_lead_idx").on(t.leadId),
    index("sent_messages_campaign_idx").on(t.campaignId),
  ],
);

/**
 * Webhook events that have already been processed.
 *
 * EmailEngine retries a failed delivery up to ten times, and the same event
 * can arrive twice for unrelated reasons. Every handler is written to be
 * idempotent, but recording the event id makes a repeat a no-op instead of
 * repeated work.
 */
export const processedWebhookEvents = pgTable(
  "processed_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The X-EE-Wh-Event-Id header. */
    eventId: text("event_id").notNull(),
    event: text("event").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("processed_webhook_events_event_id_idx").on(t.eventId)],
);

/**
 * Which lead entered which subsequence, and how far through it they are.
 */
export const subsequenceEnrollments = pgTable(
  "subsequence_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    subsequenceId: uuid("subsequence_id")
      .notNull()
      .references(() => campaignSubsequences.id, { onDelete: "cascade" }),
    campaignLeadId: uuid("campaign_lead_id")
      .notNull()
      .references(() => campaignLeads.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    currentStepPosition: integer("current_step_position").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    nextStepAt: timestamp("next_step_at", { withTimezone: true }),
    /**
     * The main sequence waits while a lead is in a subsequence. When the
     * subsequence finishes, the lead goes back to the campaign and this is
     * cleared.
     */
    pausedCampaignLeadId: uuid("paused_campaign_lead_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("subsequence_enrollments_unique_idx").on(
      t.subsequenceId,
      t.campaignLeadId,
    ),
    index("subsequence_enrollments_next_idx").on(t.nextStepAt),
  ],
);

/**
 * A rule that pauses a campaign when a metric crosses a threshold.
 *
 * The metrics are the ones that predict trouble: a bounce rate that climbs,
 * a reply rate that collapses, a mailbox whose health drops. Pausing
 * automatically is the difference between a bad afternoon and a blacklisted
 * sending domain.
 */
export const autoPauseRules = pgTable(
  "auto_pause_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null means the rule applies to every campaign in the workspace. */
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "cascade",
    }),
    /**
     * The metric to watch: "bounce_rate", "reply_rate", "open_rate",
     * "spam_rate" or "mailbox_health".
     */
    metric: text("metric").notNull(),
    /** The value the metric is compared against. */
    threshold: real("threshold").notNull(),
    /** "above" fires when the metric rises past the threshold. */
    direction: text("direction").notNull().default("above"),
    /** What to do when it fires: "pause_campaign" or "pause_mailbox". */
    action: text("action").notNull().default("pause_campaign"),
    enabled: integer("enabled").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  },
  (t) => [
    index("auto_pause_rules_workspace_idx").on(t.workspaceId),
    index("auto_pause_rules_campaign_idx").on(t.campaignId),
  ],
);

/**
 * When a rule fired, what the metric was, and what was done about it.
 *
 * The history is the point: a pause with no explanation is an outage, and a
 * pause with a history is a decision.
 */
export const autoPauseEvents = pgTable(
  "auto_pause_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => autoPauseRules.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "cascade",
    }),
    /** The metric value that triggered the rule. */
    metricValue: real("metric_value").notNull(),
    actionTaken: text("action_taken").notNull(),
    firedAt: timestamp("fired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("auto_pause_events_rule_idx").on(t.ruleId),
    index("auto_pause_events_campaign_idx").on(t.campaignId),
  ],
);
