import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { alertSeverityEnum } from "./enums";
import { workspaces } from "./core";

/**
 * Who gets told when something breaks.
 *
 * A row is one address. Several rows means several people hear about an
 * incident — the operator can add a second address without touching the
 * code or the environment.
 *
 * `severity` is the *lowest* severity this address wants to hear about:
 * "warning" receives everything, "error" receives only errors. A colleague
 * who wants the pager and not the noise says "error"; the person who wants
 * to see a degraded system says "warning".
 */
export const alertRecipients = pgTable(
  "alert_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** An optional label, so the dashboard can say who this is. */
    name: text("name"),
    severity: alertSeverityEnum("severity").notNull().default("error"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_recipients_workspace_email_idx").on(
      t.workspaceId,
      t.email,
    ),
    index("alert_recipients_workspace_idx").on(t.workspaceId),
  ],
);

export type AlertRecipientRow = typeof alertRecipients.$inferSelect;
export type NewAlertRecipientRow = typeof alertRecipients.$inferInsert;
