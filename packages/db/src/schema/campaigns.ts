import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  campaignStateEnum,
  campaignStatusEnum,
  subsequenceTriggerEnum,
  threadModeEnum,
} from "./enums";
import { leads } from "./leads";
import { mailboxes, workspaces } from "./core";

/** Campaigns. */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    name: text("name").notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    dailyLimit: integer("daily_limit"),
    dailyMaxLeads: integer("daily_max_leads"),
    emailGapMinutes: integer("email_gap_minutes").notNull().default(9),
    randomWaitMax: integer("random_wait_max").notNull().default(5),
    stopOnReply: boolean("stop_on_reply").notNull().default(true),
    stopOnAutoReply: boolean("stop_on_auto_reply").notNull().default(false),
    stopForCompany: boolean("stop_for_company").notNull().default(true),
    openTracking: boolean("open_tracking").notNull().default(true),
    linkTracking: boolean("link_tracking").notNull().default(true),
    textOnly: boolean("text_only").notNull().default(false),
    insertUnsubscribeHeader: boolean("insert_unsubscribe_header")
      .notNull()
      .default(true),
    allowRiskyContacts: boolean("allow_risky_contacts").notNull().default(false),
    /**
     * When a lead is added to a list attached to this campaign, enroll it
     * straight away. With this off, the list is a snapshot taken at launch.
     */
    enrollOnAdd: boolean("enroll_on_add").notNull().default(true),
    schedule: jsonb("schedule").notNull().default({}),
    ownerId: uuid("owner_id"),
    pausedReason: text("paused_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("campaigns_status_idx").on(t.status), index("campaigns_workspace_idx").on(t.workspaceId)],
);

/** Sequence steps within a campaign. */
export const campaignSteps = pgTable(
  "campaign_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    subject: text("subject"),
    bodyHtml: text("body_html").notNull().default(""),
    bodyText: text("body_text"),
    preheader: text("preheader"),
    delayMinutes: integer("delay_minutes").notNull().default(0),
    threadMode: threadModeEnum("thread_mode").notNull().default("reply"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_steps_position_idx").on(t.campaignId, t.position),
  ],
);

/** A/Z variants within a step. */
export const stepVariants = pgTable(
  "step_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stepId: uuid("step_id")
      .notNull()
      .references(() => campaignSteps.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    subject: text("subject"),
    bodyHtml: text("body_html").notNull().default(""),
    weight: integer("weight").notNull().default(100),
    pinned: integer("pinned").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("step_variants_step_idx").on(t.stepId)],
);

/**
 * Which mailboxes a campaign may send from.
 *
 * Multi-client teams must not have one client's campaign sending from another
 * client's mailbox. When a campaign has no explicit assignment, the scheduler
 * falls back to every connected mailbox in the workspace.
 */
export const campaignMailboxes = pgTable(
  "campaign_mailboxes",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_mailboxes_pk_idx").on(t.campaignId, t.mailboxId),
    index("campaign_mailboxes_mailbox_idx").on(t.mailboxId),
  ],
);

/** Enrollment + per-lead state within a campaign. */
export const campaignLeads = pgTable(
  "campaign_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    currentStepId: uuid("current_step_id").references(() => campaignSteps.id, {
      onDelete: "set null",
    }),
    state: campaignStateEnum("state").notNull().default("active"),
    stoppedReason: text("stopped_reason"),
    nextStepAt: timestamp("next_step_at", { withTimezone: true }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    variantAssignments: jsonb("variant_assignments").notNull().default({}),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    enteredAt: timestamp("entered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("campaign_leads_unique_idx").on(t.campaignId, t.leadId),
    index("campaign_leads_state_idx").on(t.state),
    index("campaign_leads_next_step_idx").on(t.nextStepAt),
  ],
);

/** Outbox for the dispatcher. */
export const sendJobs = pgTable(
  "send_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignLeadId: uuid("campaign_lead_id")
      .notNull()
      .references(() => campaignLeads.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => campaignSteps.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => stepVariants.id, {
      onDelete: "set null",
    }),
    /**
     * Set when the send comes from a subsequence rather than the main
     * sequence. Exactly one of `stepId`/`subsequenceStepId` identifies what
     * is being sent.
     */
    subsequenceStepId: uuid("subsequence_step_id").references(
      () => campaignSubsequenceSteps.id,
      { onDelete: "cascade" },
    ),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("send_jobs_state_idx").on(t.state),
    index("send_jobs_scheduled_idx").on(t.scheduledAt),
    index("send_jobs_mailbox_idx").on(t.mailboxId),
  ],
);

/** Bounce detail. */
export const bounces = pgTable(
  "bounces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, {
      onDelete: "set null",
    }),
    stepId: uuid("step_id").references(() => campaignSteps.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    code: text("code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("bounces_lead_idx").on(t.leadId), index("bounces_campaign_idx").on(t.campaignId)],
);

/** Global suppression list. */
export const blocklist = pgTable(
  "blocklist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    type: text("type").notNull(), // 'email' | 'domain'
    value: text("value").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("blocklist_value_idx").on(t.workspaceId, t.type, t.value),
  ],
);

/**
 * A follow-up sequence that a lead enters part-way through a campaign.
 *
 * A subsequence is a list of steps with its own delays. When its trigger
 * fires — the lead replied, replied with a keyword, or changed status — the
 * lead leaves the main sequence and follows the subsequence instead.
 */
export const campaignSubsequences = pgTable(
  "campaign_subsequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: subsequenceTriggerEnum("trigger").notNull().default("reply"),
    /** For `reply_keyword`: the word that arms the sequence. */
    triggerKeyword: text("trigger_keyword"),
    /** For `status_change`: the lead status that arms the sequence. */
    triggerStatusId: integer("trigger_status_id"),
    active: integer("active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("subsequences_campaign_idx").on(t.campaignId)],
);

/** One step inside a subsequence. */
export const campaignSubsequenceSteps = pgTable(
  "campaign_subsequence_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subsequenceId: uuid("subsequence_id")
      .notNull()
      .references(() => campaignSubsequences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    subject: text("subject"),
    bodyHtml: text("body_html").notNull().default(""),
    /** Wait before this step, in minutes. */
    delayMinutes: integer("delay_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("subsequence_steps_position_idx").on(t.subsequenceId, t.position),
  ],
);
