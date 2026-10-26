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

import { mailboxProviderEnum, mailboxStatusEnum, userRoleEnum } from "./enums";

/** Operators. Internal tool: an admin creates users, no invitations, no SSO. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull().default("member"),
    passwordHash: text("password_hash").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. The raw token only ever lives in the cookie. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Single-tenant for now, but every domain table carries workspace_id so
 * multi-tenant is a data-layer change rather than a migration.
 */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Sending mailboxes. `emailengineId` mirrors the account in EmailEngine. */
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    provider: mailboxProviderEnum("provider").notNull(),
    status: mailboxStatusEnum("status").notNull().default("connected"),
    emailengineId: text("emailengine_id").notNull(),
    /** Per-mailbox daily cap on campaign emails. Hard ceiling is 50. */
    dailyCap: integer("daily_cap").notNull().default(30),
    /** 0–100, derived from bounce/error/open/reply rates. Below 40 → degraded. */
    healthScore: real("health_score").notNull().default(100),
    tags: text("tags").array().notNull().default([]),
    replyTo: text("reply_to"),
    signatureHtml: text("signature_html"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mailboxes_email_idx").on(t.email),
    index("mailboxes_status_idx").on(t.status),
    index("mailboxes_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * Per-mailbox, per-day counters. The dispatcher reads these to enforce the
 * daily cap and writes to them after each confirmed send.
 */
export const mailboxDailyStats = pgTable(
  "mailbox_daily_stats",
  {
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    /** Calendar date in the workspace timezone, as YYYY-MM-DD. */
    date: text("date").notNull(),
    sent: integer("sent").notNull().default(0),
    bounced: integer("bounced").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mailbox_daily_stats_pk_idx").on(t.mailboxId, t.date),
    index("mailbox_daily_stats_date_idx").on(t.date),
  ],
);
