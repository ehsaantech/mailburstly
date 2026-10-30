import { and, eq, lte, sql } from "drizzle-orm";
import {
  conversations,
  mailboxes,
  messages,
  type Database,
} from "@mailrung/db";

export function createScheduledReplyRepository({ db }: { db: Database }) {
  return {
    /** Conversations whose scheduled reply is due. */
    async due(now: Date) {
      return db
        .select({
          conversation: conversations,
          mailboxEmail: mailboxes.email,
          mailboxEmailEngineId: mailboxes.mailcoreAccountId,
        })
        .from(conversations)
        .innerJoin(mailboxes, eq(mailboxes.id, conversations.mailboxId))
        .where(
          and(
            lte(conversations.scheduledReplyAt, now),
            sql`${conversations.scheduledReplyAt} IS NOT NULL`,
          ),
        );
    },

    /** The last inbound message, so the reply threads. */
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
        .orderBy(sql`${messages.receivedAt} DESC`)
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

    /** Clears the scheduled reply, whatever the outcome of sending it. */
    async clearScheduled(conversationId: string) {
      await db
        .update(conversations)
        .set({ scheduledReplyAt: null, scheduledReplyBody: null })
        .where(eq(conversations.id, conversationId));
    },

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
      await db.execute(
        sql`INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, variant_id, type, meta, created_at)
            VALUES (${entry.workspaceId}, ${entry.campaignId}, ${entry.leadId}, ${entry.mailboxId}, ${entry.stepId}, ${entry.variantId}, ${entry.type}, ${JSON.stringify(entry.meta ?? {})}, now())`,
      );
    },
  };
}

export type ScheduledReplyRepository = ReturnType<
  typeof createScheduledReplyRepository
>;
