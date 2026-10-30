import {
  and,
  desc,
  eq,
  getTableColumns,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import {
  activities,
  campaignLeads,
  campaigns,
  conversations,
  leadLabels,
  leadStatusEvents,
  leads,
  macros,
  mailboxes,
  messages,
  opportunities,
  workspaces,
  type Database,
} from "@mailrung/db";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

/** The folders the inbox can show. */
export type Folder =
  | "primary"
  | "unread"
  | "reminders"
  | "scheduled"
  | "sent"
  | "others"
  | "archived";

/**
 * The SQL for a folder.
 *
 * Each folder is a different question about a conversation, so each is a
 * different condition:
 *
 *   primary   — a lead we know, who has written back
 *   unread    — an inbound message nobody has read
 *   reminders — the operator asked to be reminded
 *   scheduled — a reply is waiting to go out
 *   sent      — we wrote, they never answered
 *   others    — they wrote, we do not know who they are
 *   archived  — filed away
 */
function folderCondition(folder: Folder) {
  switch (folder) {
    case "primary":
      return and(
        sql`${conversations.leadId} IS NOT NULL`,
        sql`${conversations.hasReply} = 1`,
        sql`${conversations.status} <> 'archived'`,
      )!;
    case "unread":
      return sql`${conversations.hasUnread} = 1 AND ${conversations.status} <> 'archived'`;
    case "reminders":
      return sql`${conversations.remindAt} IS NOT NULL AND ${conversations.status} <> 'archived'`;
    case "scheduled":
      return sql`${conversations.scheduledReplyAt} IS NOT NULL AND ${conversations.status} <> 'archived'`;
    case "sent":
      return and(
        sql`${conversations.hasReply} = 0`,
        sql`${conversations.status} <> 'archived'`,
      )!;
    case "others":
      return and(
        sql`${conversations.leadId} IS NULL`,
        sql`${conversations.hasReply} = 1`,
        sql`${conversations.status} <> 'archived'`,
      )!;
    case "archived":
      return eq(conversations.status, "archived");
  }
}

export function createInboxRepository({ db }: { db: Database }) {
  return {
    /* --------------------------- conversations --------------------------- */

    async listConversations(
      workspaceId: string,
      query: {
        limit: number;
        offset: number;
        status?: "open" | "closed" | "archived";
        folder?: Folder;
        hasReply?: boolean;
        search?: string;
        campaignId?: string;
        mailboxId?: string;
      },
    ) {
      const conditions = [eq(conversations.workspaceId, workspaceId)];

      if (query.status) conditions.push(eq(conversations.status, query.status));
      if (query.folder) conditions.push(folderCondition(query.folder));
      if (query.hasReply !== undefined) {
        conditions.push(eq(conversations.hasReply, query.hasReply ? 1 : 0));
      }
      if (query.campaignId) {
        conditions.push(eq(conversations.campaignId, query.campaignId));
      }
      if (query.mailboxId) {
        conditions.push(eq(conversations.mailboxId, query.mailboxId));
      }
      if (query.search) {
        const term = `%${query.search}%`;
        conditions.push(
          or(
            ilike(conversations.contactEmail, term),
            ilike(conversations.subject, term),
          )!,
        );
      }

      return db
        .select({
          ...getTableColumns(conversations),
          mailboxEmail: mailboxes.email,
          leadFirstName: leads.firstName,
          leadLastName: leads.lastName,
          leadCompany: leads.company,
        })
        .from(conversations)
        .innerJoin(mailboxes, eq(mailboxes.id, conversations.mailboxId))
        .leftJoin(leads, eq(leads.id, conversations.leadId))
        .where(and(...conditions))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(query.limit)
        .offset(query.offset);
    },

    async countConversations(
      workspaceId: string,
      query: {
        status?: "open" | "closed" | "archived";
        folder?: Folder;
        hasReply?: boolean;
        search?: string;
        campaignId?: string;
        mailboxId?: string;
      },
    ) {
      const conditions = [eq(conversations.workspaceId, workspaceId)];

      if (query.status) conditions.push(eq(conversations.status, query.status));
      if (query.folder) conditions.push(folderCondition(query.folder));
      if (query.hasReply !== undefined) {
        conditions.push(eq(conversations.hasReply, query.hasReply ? 1 : 0));
      }
      if (query.campaignId) {
        conditions.push(eq(conversations.campaignId, query.campaignId));
      }
      if (query.mailboxId) {
        conditions.push(eq(conversations.mailboxId, query.mailboxId));
      }
      if (query.search) {
        const term = `%${query.search}%`;
        conditions.push(
          or(
            ilike(conversations.contactEmail, term),
            ilike(conversations.subject, term),
          )!,
        );
      }

      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversations)
        .where(and(...conditions));
      return rows[0]?.count ?? 0;
    },

    async conversationById(workspaceId: string, id: string) {
      const rows = await db
        .select({
          ...getTableColumns(conversations),
          mailboxEmail: mailboxes.email,
          mailboxEmailEngineId: mailboxes.mailcoreAccountId,
          leadFirstName: leads.firstName,
          leadLastName: leads.lastName,
          leadCompany: leads.company,
        })
        .from(conversations)
        .innerJoin(mailboxes, eq(mailboxes.id, conversations.mailboxId))
        .leftJoin(leads, eq(leads.id, conversations.leadId))
        .where(
          and(
            eq(conversations.workspaceId, workspaceId),
            eq(conversations.id, id),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async updateConversation(
      id: string,
      patch: {
        status?: "open" | "closed" | "archived";
        remindAt?: Date | null;
        scheduledReplyAt?: Date | null;
        scheduledReplyBody?: string | null;
        hasUnread?: number;
        hasReply?: number;
        leadId?: string | null;
        campaignId?: string | null;
        contactEmail?: string;
      },
    ) {
      const rows = await db
        .update(conversations)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(conversations.id, id))
        .returning();
      return rows[0] ?? null;
    },

    /* ------------------------------ messages ----------------------------- */

    async messagesForConversation(conversationId: string) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.receivedAt);
    },

    async lastInboundMessage(conversationId: string) {
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.direction, "inbound"),
          ),
        )
        .orderBy(desc(messages.receivedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async messageById(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, workspaceId),
            eq(messages.id, id),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async insertMessage(entry: {
      workspaceId: string;
      conversationId: string;
      mailboxId: string;
      leadId: string | null;
      campaignId: string | null;
      providerMessageId: string | null;
      direction: "inbound" | "outbound";
      fromAddress: string;
      toAddress: string | null;
      subject: string | null;
      textBody: string | null;
      htmlBody: string | null;
      snippet: string | null;
      classification:
        | "unclassified"
        | "positive"
        | "negative"
        | "neutral"
        | "question"
        | "out_of_office"
        | "unsubscribe"
        | "bounce"
        | "other";
      isAutoReply: number;
      isOutOfOffice: number;
      oooResumeAt: Date | null;
      isUnsubscribe: number;
      receivedAt: Date;
    }) {
      const rows = await db.insert(messages).values(entry).returning();
      return rows[0]!;
    },

    async markConversationRead(conversationId: string) {
      await db
        .update(messages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(messages.conversationId, conversationId),
            sql`${messages.readAt} IS NULL`,
          ),
        );
    },

    /* ------------------------------ activity ----------------------------- */

    async recordActivity(entry: {
      workspaceId: string;
      campaignId: string | null;
      leadId: string | null;
      mailboxId: string | null;
      stepId: string | null;
      variantId: string | null;
      type:
        | "email_sent"
        | "email_opened"
        | "link_clicked"
        | "reply_received"
        | "auto_reply"
        | "bounced"
        | "unsubscribed"
        | "status_changed"
        | "subsequence_entered";
      meta?: Record<string, unknown>;
    }) {
      await db.insert(activities).values({ ...entry, meta: entry.meta ?? {} });
    },

    /* -------------------------- campaign leads -------------------------- */

    /**
     * The lead's enrollment in the campaign this conversation belongs to.
     *
     * A manual reply is a human deciding the lead is engaged, so the
     * campaign's `stop_on_reply` setting is honoured: the lead's sequence
     * stops rather than continuing to email someone who just wrote back.
     */
    async campaignLeadFor(leadId: string, campaignId: string) {
      const rows = await db
        .select({
          campaignLead: campaignLeads,
          stopOnReply: campaigns.stopOnReply,
        })
        .from(campaignLeads)
        .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
        .where(
          and(
            eq(campaignLeads.leadId, leadId),
            eq(campaignLeads.campaignId, campaignId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async stopCampaignLead(id: string, reason: string) {
      await db
        .update(campaignLeads)
        .set({ state: "stopped", stoppedReason: reason, nextStepAt: null })
        .where(eq(campaignLeads.id, id));
    },

    /* --------------------------- lead timeline --------------------------- */

    async leadStatusTimeline(workspaceId: string, leadId: string) {
      return db
        .select({
          event: leadStatusEvents,
          labelName: leadLabels.name,
          labelInterest: leadLabels.interest,
        })
        .from(leadStatusEvents)
        .leftJoin(leadLabels, eq(leadLabels.id, leadStatusEvents.labelId))
        .where(
          and(
            eq(leadStatusEvents.workspaceId, workspaceId),
            eq(leadStatusEvents.leadId, leadId),
          ),
        )
        .orderBy(desc(leadStatusEvents.createdAt));
    },

    async leadStatusLabels(workspaceId: string) {
      return db
        .select()
        .from(leadLabels)
        .where(eq(leadLabels.workspaceId, workspaceId))
        .orderBy(leadLabels.name);
    },

    /** A campaign, for the suggestion's context. */
    async campaignById(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.workspaceId, workspaceId),
            eq(campaigns.id, id),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async leadById(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(leads)
        .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, id)))
        .limit(1);
      return rows[0] ?? null;
    },

    /* ------------------------------ settings --------------------------- */

    /** The workspace's own settings, for the reply-classification model. */
    async workspaceSettings(): Promise<{ llm?: { model?: string } } | null> {
      const rows = await db
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .limit(1);
      const settings = rows[0]?.settings as
        | { llm?: { model?: string } }
        | undefined;
      return settings ?? null;
    },

    /* --------------------------- opportunities --------------------------- */

    async listOpportunities(
      workspaceId: string,
      query: {
        limit: number;
        offset: number;
        status?: "open" | "won" | "lost";
        campaignId?: string;
      },
    ) {
      const conditions = [eq(opportunities.workspaceId, workspaceId)];
      if (query.status) conditions.push(eq(opportunities.status, query.status));
      if (query.campaignId) {
        conditions.push(eq(opportunities.campaignId, query.campaignId));
      }

      return db
        .select({
          ...getTableColumns(opportunities),
          leadEmail: leads.email,
          leadFirstName: leads.firstName,
          leadLastName: leads.lastName,
          leadCompany: leads.company,
        })
        .from(opportunities)
        .innerJoin(leads, eq(leads.id, opportunities.leadId))
        .where(and(...conditions))
        .orderBy(desc(opportunities.createdAt))
        .limit(query.limit)
        .offset(query.offset);
    },

    async countOpportunities(
      workspaceId: string,
      query: { status?: "open" | "won" | "lost"; campaignId?: string },
    ) {
      const conditions = [eq(opportunities.workspaceId, workspaceId)];
      if (query.status) conditions.push(eq(opportunities.status, query.status));
      if (query.campaignId) {
        conditions.push(eq(opportunities.campaignId, query.campaignId));
      }
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(opportunities)
        .where(and(...conditions));
      return rows[0]?.count ?? 0;
    },

    async opportunityById(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.workspaceId, workspaceId),
            eq(opportunities.id, id),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async updateOpportunity(
      id: string,
      patch: {
        status?: "open" | "won" | "lost";
        value?: number | null;
        title?: string;
      },
    ) {
      const rows = await db
        .update(opportunities)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(opportunities.id, id))
        .returning();
      return rows[0] ?? null;
    },

    /* ------------------------------- macros ------------------------------ */

    async listMacros(workspaceId: string) {
      return db
        .select()
        .from(macros)
        .where(eq(macros.workspaceId, workspaceId))
        .orderBy(macros.name);
    },

    async macroById(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(macros)
        .where(and(eq(macros.workspaceId, workspaceId), eq(macros.id, id)))
        .limit(1);
      return rows[0] ?? null;
    },

    async createMacro(entry: {
      workspaceId: string;
      name: string;
      bodyHtml: string;
      bodyText: string | null;
    }) {
      const rows = await db.insert(macros).values(entry).returning();
      return rows[0]!;
    },

    async updateMacro(id: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(macros)
        .set(patch)
        .where(eq(macros.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async removeMacro(id: string) {
      await db.delete(macros).where(eq(macros.id, id));
    },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
