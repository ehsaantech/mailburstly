import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { leads } from "./leads";
import { users, workspaces } from "./core";
import { campaigns } from "./campaigns";

/**
 * A named, reusable collection of leads.
 *
 * A list is a view, not a copy: the leads belong to the workspace, and a
 * list only points at them. Deleting a list therefore never deletes a lead.
 */
export const leadLists = pgTable(
  "lead_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_lists_name_idx").on(t.workspaceId, t.name),
    index("lead_lists_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * The leads in a list. A lead may be in many lists.
 */
export const leadListMembers = pgTable(
  "lead_list_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => leadLists.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_list_members_unique_idx").on(t.listId, t.leadId),
    index("lead_list_members_lead_idx").on(t.leadId),
  ],
);

/**
 * The lists attached to a campaign.
 *
 * The attachment is what makes a list useful: enrolling a list enrolls
 * everyone in it, and — when the campaign enrolls on add — a lead added to
 * the list afterwards is enrolled too.
 */
export const campaignLists = pgTable(
  "campaign_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => leadLists.id, { onDelete: "cascade" }),
    attachedAt: timestamp("attached_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_lists_unique_idx").on(t.campaignId, t.listId),
    index("campaign_lists_list_idx").on(t.listId),
  ],
);

/**
 * Watchers attached to a list.
 */
export const listWatchers = pgTable(
  "list_watchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => leadLists.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("list_watchers_unique_idx").on(t.listId, t.userId),
    index("list_watchers_list_idx").on(t.listId),
    index("list_watchers_user_idx").on(t.userId),
  ],
);
