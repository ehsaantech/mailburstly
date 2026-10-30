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
  classificationEnum,
  conversationStatusEnum,
  messageDirectionEnum,
  opportunityStatusEnum,
} from "./enums";
import { campaigns } from "./campaigns";
import { leadLabels, leads } from "./leads";
import { mailboxes, workspaces } from "./core";

/**
 * A conversation threads every message exchanged with one contact on one
 * mailbox. Replies are grouped by campaign so a lead contacted twice by two
 * campaigns keeps two separate threads.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    /** Contact address. Denormalised so an unmatched lead still has a thread. */
    contactEmail: text("contact_email").notNull(),
    subject: text("subject"),
    status: conversationStatusEnum("status").notNull().default("open"),
    /** True when a reply was detected and the campaign should stop. */
    hasReply: integer("has_reply").notNull().default(0),
    /** True when an inbound message has not been read. */
    hasUnread: integer("has_unread").notNull().default(0),
    /** When the operator asked to be reminded about this conversation. */
    remindAt: timestamp("remind_at", { withTimezone: true }),
    /** When a drafted reply should go out, if one is scheduled. */
    scheduledReplyAt: timestamp("scheduled_reply_at", { withTimezone: true }),
    scheduledReplyBody: text("scheduled_reply_body"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversations_workspace_idx").on(t.workspaceId),
    index("conversations_lead_idx").on(t.leadId),
    index("conversations_campaign_idx").on(t.campaignId),
    index("conversations_last_message_idx").on(t.lastMessageAt),
  ],
);

/**
 * One inbound or outbound message. `providerMessageId` is mailcore's own
 * id, which is what makes ingestion idempotent: a webhook redelivery updates
 * the existing row instead of creating a second one.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    providerMessageId: text("provider_message_id"),
    direction: messageDirectionEnum("direction").notNull().default("inbound"),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address"),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    snippet: text("snippet"),
    classification: classificationEnum("classification")
      .notNull()
      .default("unclassified"),
    /** True when the message looks like an out-of-office autoreply. */
    isAutoReply: integer("is_auto_reply").notNull().default(0),
    /** True when the message is an out-of-office and says when it ends. */
    isOutOfOffice: integer("is_out_of_office").notNull().default(0),
    /** When the contact said they will be back, if they said so. */
    oooResumeAt: timestamp("ooo_resume_at", { withTimezone: true }),
    /** Unsubscribed contact — never contact again. */
    isUnsubscribe: integer("is_unsubscribe").notNull().default(0),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_provider_id_idx").on(t.providerMessageId),
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_lead_idx").on(t.leadId),
    index("messages_campaign_idx").on(t.campaignId),
    index("messages_received_idx").on(t.receivedAt),
  ],
);

/**
 * A change to a lead's status. The timeline is append-only: the current
 * status lives on the lead, the history lives here.
 */
export const leadStatusEvents = pgTable(
  "lead_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    /** Null when the status was cleared. */
    labelId: integer("label_id").references(() => leadLabels.id, {
      onDelete: "set null",
    }),
    labelName: text("label_name"),
    /** Where the change came from: 'reply', 'ai', 'manual', 'bounce'. */
    source: text("source").notNull(),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lead_status_events_lead_idx").on(t.leadId),
    index("lead_status_events_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * A saved reply snippet.
 *
 * Macros let the operator answer the same kind of email repeatedly without
 * retyping it. They are workspace-scoped and short by design — a macro that
 * needs editing is a template, not a macro.
 */
export const macros = pgTable(
  "macros",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    bodyHtml: text("body_html").notNull().default(""),
    bodyText: text("body_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("macros_name_idx").on(t.workspaceId, t.name),
    index("macros_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * A positive signal worth acting on: a reply that asked for pricing, a
 * meeting request, a budget signal. Only positive-interest leads qualify.
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    summary: text("summary"),
    /** Rough value in the workspace's currency. Optional. */
    value: real("value"),
    status: opportunityStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("opportunities_lead_idx").on(t.leadId),
    index("opportunities_status_idx").on(t.status),
  ],
);
