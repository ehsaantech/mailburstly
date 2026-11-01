import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  activities,
  blocklist,
  bounces,
  campaignLeads,
  campaignLists,
  campaigns,
  conversations,
  leadLabels,
  leadListMembers,
  leadLists,
  leadStatusEvents,
  leads,
  listWatchers,
  mailboxes,
  messages,
  notifications,
  opportunities,
  processedWebhookEvents,
  sentMessages,
  users,
  workspaces,
  workspaceMembers,
  type Database,
} from "@mailrung/db";

/**
 * The db layer for the mailcore event pipeline.
 *
 * Every write the pipeline performs lives here, so the services above can be
 * read as business logic and the SQL stays in one place.
 */
export function createEventsRepository({ db }: { db: Database }) {
  return {
    /* ------------------------------ workspace ----------------------------- */

    async workspaceId(): Promise<string | null> {
      const rows = await db
        .select({ id: sql<string>`id` })
        .from(sql`workspaces`)
        .limit(1);
      return rows[0]?.id ?? null;
    },

    /* ---------------------------- idempotency ---------------------------- */

    /**
     * True when this event id was already handled.
     *
     * mailcore retries a failed delivery up to ten times, so the same
     * event really does arrive more than once.
     */
    async isEventProcessed(eventId: string): Promise<boolean> {
      const rows = await db
        .select({ id: processedWebhookEvents.id })
        .from(processedWebhookEvents)
        .where(eq(processedWebhookEvents.eventId, eventId))
        .limit(1);
      return rows.length > 0;
    },

    async markEventProcessed(eventId: string, event: string) {
      await db
        .insert(processedWebhookEvents)
        .values({ eventId, event })
        .onConflictDoNothing();
    },

    /* ------------------------------ mailboxes ---------------------------- */

    async mailboxByMailcoreAccountId(mailcoreAccountId: string) {
      const rows = await db
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.mailcoreAccountId, mailcoreAccountId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** True when the address is one of our sending mailboxes. */
    async isOwnAddress(address: string): Promise<boolean> {
      const rows = await db
        .select({ id: mailboxes.id })
        .from(mailboxes)
        .where(sql`lower(${mailboxes.email}) = lower(${address})`)
        .limit(1);
      return rows.length > 0;
    },

    /* -------------------------------- leads ------------------------------ */

    async leadByEmail(workspaceId: string, email: string) {
      const rows = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.workspaceId, workspaceId),
            sql`lower(${leads.email}) = lower(${email})`,
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async leadById(id: string) {
      const rows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async labelByName(workspaceId: string, name: string) {
      const rows = await db
        .select()
        .from(leadLabels)
        .where(
          and(
            eq(leadLabels.workspaceId, workspaceId),
            sql`lower(${leadLabels.name}) = lower(${name})`,
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async labelById(id: number) {
      const rows = await db
        .select()
        .from(leadLabels)
        .where(eq(leadLabels.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async setLeadStatus(leadId: string, labelId: number | null) {
      await db
        .update(leads)
        .set({ statusId: labelId, lastActivityAt: new Date() })
        .where(eq(leads.id, leadId));
    },

    async setLeadOooUntil(leadId: string, until: Date | null) {
      await db
        .update(leads)
        .set({ oooUntil: until })
        .where(eq(leads.id, leadId));
    },

    async setLeadUnsubscribed(leadId: string) {
      await db
        .update(leads)
        .set({ unsubscribed: 1, lastActivityAt: new Date() })
        .where(eq(leads.id, leadId));
    },

    async setLeadInvalid(leadId: string) {
      await db
        .update(leads)
        .set({ emailStatus: "invalid", lastActivityAt: new Date() })
        .where(eq(leads.id, leadId));
    },

    async insertLeadStatusEvent(entry: {
      workspaceId: string;
      leadId: string;
      labelId: number | null;
      labelName: string | null;
      source: string;
      meta?: Record<string, unknown>;
    }) {
      await db.insert(leadStatusEvents).values({
        workspaceId: entry.workspaceId,
        leadId: entry.leadId,
        labelId: entry.labelId,
        labelName: entry.labelName,
        source: entry.source,
        meta: entry.meta ?? {},
      });
    },

    /* --------------------------- campaign leads -------------------------- */

    /**
     * The campaign a reply belongs to.
     *
     * A contact can be in several campaigns; the reply belongs to the one
     * that most recently sent them something.
     */
    async latestCampaignForLead(leadId: string) {
      const rows = await db
        .select()
        .from(campaignLeads)
        .where(eq(campaignLeads.leadId, leadId))
        .orderBy(desc(campaignLeads.lastSentAt))
        .limit(1);
      return rows[0] ?? null;
    },

    /** The enrollment of a lead in one campaign. */
    async campaignLeadForLead(leadId: string, campaignId: string) {
      const rows = await db
        .select()
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.leadId, leadId),
            eq(campaignLeads.campaignId, campaignId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    /** Stop every campaign this lead is part of. */
    async stopLeadEverywhere(leadId: string, reason: string) {
      await db
        .update(campaignLeads)
        .set({ state: "stopped", stoppedReason: reason, nextStepAt: null })
        .where(
          and(
            eq(campaignLeads.leadId, leadId),
            inArray(campaignLeads.state, ["active", "paused"]),
          ),
        );
    },

    /* --------------------------- conversations --------------------------- */

    async findConversation(entry: {
      workspaceId: string;
      mailboxId: string;
      leadId: string | null;
      campaignId: string | null;
      contactEmail: string;
    }) {
      const rows = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, entry.workspaceId),
            eq(conversations.mailboxId, entry.mailboxId),
            eq(conversations.contactEmail, entry.contactEmail),
            entry.campaignId
              ? eq(conversations.campaignId, entry.campaignId)
              : sql`${conversations.campaignId} IS NULL`,
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async createConversation(entry: {
      workspaceId: string;
      mailboxId: string;
      leadId: string | null;
      campaignId: string | null;
      contactEmail: string;
      subject: string | null;
    }) {
      const rows = await db
        .insert(conversations)
        .values({
          workspaceId: entry.workspaceId,
          mailboxId: entry.mailboxId,
          leadId: entry.leadId,
          campaignId: entry.campaignId,
          contactEmail: entry.contactEmail,
          subject: entry.subject,
        })
        .returning();
      return rows[0]!;
    },

    async touchConversation(id: string, patch: { hasReply?: number; status?: "open" | "closed" | "archived" }) {
      await db
        .update(conversations)
        .set({
          ...patch,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, id));
    },

    /* ------------------------------ messages ----------------------------- */

    async messageByProviderId(providerMessageId: string) {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.providerMessageId, providerMessageId))
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

    async markMessageRead(id: string) {
      await db
        .update(messages)
        .set({ readAt: new Date() })
        .where(eq(messages.id, id));
    },

    /* --------------------------- sent messages --------------------------- */

    async sentMessageById(messageId: string) {
      const rows = await db
        .select()
        .from(sentMessages)
        .where(
          sql`${sentMessages.messageId} = ${messageId} OR ${sentMessages.originalMessageId} = ${messageId}`,
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async recordSentMessage(entry: {
      workspaceId: string;
      messageId: string;
      originalMessageId: string | null;
      leadId: string | null;
      campaignId: string | null;
      mailboxId: string | null;
      stepId: string | null;
      variantId: string | null;
      recipient: string;
      subject: string | null;
    }) {
      await db
        .insert(sentMessages)
        .values(entry)
        .onConflictDoNothing();
    },

    /* ---------------------------- activities ----------------------------- */

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

    /* ------------------------------ bounces ------------------------------ */

    async insertBounce(entry: {
      leadId: string;
      campaignId: string | null;
      mailboxId: string | null;
      stepId: string | null;
      reason: string;
      code: string | null;
    }) {
      await db.insert(bounces).values(entry);
    },

    async addToBlocklist(workspaceId: string, value: string, source: string) {
      await db
        .insert(blocklist)
        .values({ workspaceId, type: "email", value, source })
        .onConflictDoNothing();
    },

    /* --------------------------- opportunities --------------------------- */

    async insertOpportunity(entry: {
      workspaceId: string;
      leadId: string;
      conversationId: string | null;
      campaignId: string | null;
      title: string;
      summary: string | null;
    }) {
      const rows = await db.insert(opportunities).values(entry).returning();
      return rows[0]!;
    },

    async opportunityForConversation(conversationId: string) {
      const rows = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.conversationId, conversationId))
        .limit(1);
      return rows[0] ?? null;
    },

    async listsForLead(workspaceId: string, leadId: string): Promise<string[]> {
      const rows = await db
        .select({ id: leadLists.id })
        .from(leadListMembers)
        .innerJoin(leadLists, eq(leadLists.id, leadListMembers.listId))
        .where(and(eq(leadListMembers.leadId, leadId), eq(leadLists.workspaceId, workspaceId)));
      return rows.map((r) => r.id);
    },

    async listsForCampaign(campaignId: string): Promise<string[]> {
      const rows = await db
        .select({ listId: campaignLists.listId })
        .from(campaignLists)
        .where(eq(campaignLists.campaignId, campaignId));
      return rows.map((r) => r.listId);
    },

    async watchersForLists(listIds: string[]): Promise<Array<{ userId: string; email?: string; name?: string }>> {
      if (listIds.length === 0) return [];
      const rows = await db
        .select({ userId: listWatchers.userId })
        .from(listWatchers)
        .where(inArray(listWatchers.listId, listIds));
      const ids = [...new Set(rows.map((r) => r.userId))];
      return ids.map((userId) => ({ userId }));
    },

    async workspaceMemberUserIds(workspaceId: string): Promise<string[]> {
      const rows = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId));
      return rows.map((r) => r.userId);
    },

    async workspaceAdmins(workspaceId: string): Promise<string[]> {
      const rows = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, "admin"),
          ),
        );
      return rows.map((r) => r.userId);
    },

    async campaignById(campaignId: string) {
      const rows = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
      return rows[0] ?? null;
    },

    async workspaceSettings(workspaceId: string) {
      const rows = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      const settings = rows[0]?.settings as any;
      return settings ?? null;
    },

    async messagesForConversation(conversationId: string) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.receivedAt);
    },

    async findConversationById(conversationId: string) {
      const rows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      return rows[0] ?? null;
    },

    async userById(userId: string) {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return rows[0] ?? null;
    },

    async insertNotifications(rows: Array<Record<string, unknown>>) {
      if (rows.length === 0) return [];
      return db.insert(notifications).values(rows as any).onConflictDoNothing({ target: notifications.dedupeKey }).returning();
    },

    async setSuggestedReply(conversationId: string, input: {
      forMessageId: string;
      text: string;
      html: string;
      model: string;
      state: "none" | "pending" | "ready" | "failed" | "sent";
      error?: string | null;
    }) {
      await db
        .update(conversations)
        .set({
          suggestedReplyHtml: input.html,
          suggestedReplyText: input.text,
          suggestedAt: new Date(),
          suggestedModel: input.model,
          suggestedState: input.state,
          suggestedError: input.error ?? null,
          suggestedForMessageId: input.forMessageId,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
    },
  };
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;
