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

import { interestEnum, leadEmailStatusEnum } from "./enums";

/** Lead status definitions (built-in + custom). */
export const leadLabels = pgTable(
  "lead_labels",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    interest: interestEnum("interest").notNull().default("neutral"),
    isBuiltin: integer("is_builtin").notNull().default(0),
    useAi: integer("use_ai").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("lead_labels_name_idx").on(t.workspaceId, t.name)],
);

/** Contacts. A lead may be in many lists and campaigns. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    title: text("title"),
    phone: text("phone"),
    statusId: integer("status_id").references(() => leadLabels.id, {
      onDelete: "set null",
    }),
    emailStatus: leadEmailStatusEnum("email_status").notNull().default("unknown"),
    verificationScore: real("verification_score"),
    customVariables: jsonb("custom_variables").notNull().default({}),
    ownerId: uuid("owner_id"),
    /**
     * Set when the contact's out-of-office says when they will be back. The
     * scheduler skips these leads until then instead of burning a send on a
     * mailbox nobody is reading.
     */
    oooUntil: timestamp("ooo_until", { withTimezone: true }),
    /** True when the contact asked to stop being contacted. */
    unsubscribed: integer("unsubscribed").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("leads_email_idx").on(t.workspaceId, t.email),
    index("leads_status_idx").on(t.statusId),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_unsubscribed_idx").on(t.unsubscribed),
  ],
);