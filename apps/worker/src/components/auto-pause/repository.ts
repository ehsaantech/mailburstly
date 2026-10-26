import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  activities,
  autoPauseEvents,
  autoPauseRules,
  campaignMailboxes,
  campaigns,
  mailboxes,
  type Database,
} from "@mailrung/db";

export function createAutoPauseRepository({ db }: { db: Database }) {
  return {
    /** Every enabled rule that applies to this campaign. */
    async rulesFor(campaignId: string) {
      return db
        .select()
        .from(autoPauseRules)
        .where(
          and(
            eq(autoPauseRules.enabled, 1),
            sql`(${autoPauseRules.campaignId} IS NULL OR ${autoPauseRules.campaignId} = ${campaignId})`,
          ),
        );
    },

    /** The campaigns that could be paused right now. */
    async activeCampaigns() {
      return db
        .select()
        .from(campaigns)
        .where(eq(campaigns.status, "active"));
    },

    /**
     * The metric a rule watches, computed over a campaign's recent activity.
     *
     * The rates are percentages, so a threshold reads the way an operator
     * would say it: "pause when the bounce rate is above 5".
     */
    async metricValue(
      campaignId: string,
      metric: string,
      sinceDays: number,
    ): Promise<number | null> {
      const since = new Date(
        Date.now() - sinceDays * 24 * 60 * 60 * 1000,
      );

      if (metric === "mailbox_health") {
        // The lowest health score among the campaign's mailboxes.
        const rows = await db
          .select({
            value: sql<number>`coalesce(min(${mailboxes.healthScore}), 100)::int`,
          })
          .from(campaignMailboxes)
          .innerJoin(mailboxes, eq(mailboxes.id, campaignMailboxes.mailboxId))
          .where(eq(campaignMailboxes.campaignId, campaignId));
        const value = rows[0]?.value;
        return typeof value === "number" ? value : null;
      }

      const rows = await db
        .select({
          sent: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          opened: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_opened')::int`,
          replied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'reply_received')::int`,
          bounced: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'bounced')::int`,
          unsubscribed: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'unsubscribed')::int`,
        })
        .from(activities)
        .where(
          and(
            eq(activities.campaignId, campaignId),
            gte(activities.createdAt, since),
          ),
        );

      const row = rows[0];
      if (!row) return null;

      const sent = row.sent ?? 0;
      // A campaign with nothing sent yet has no rate to judge. Judging it
      // would pause every new campaign on day one.
      if (sent === 0) return null;

      const rate = (numerator: number) => (numerator / sent) * 100;

      switch (metric) {
        case "bounce_rate":
          return rate(row.bounced ?? 0);
        case "reply_rate":
          return rate(row.replied ?? 0);
        case "open_rate":
          return rate(row.opened ?? 0);
        case "spam_rate":
          return rate(row.unsubscribed ?? 0);
        default:
          return null;
      }
    },

    /** Pauses a campaign and says why. */
    async pauseCampaign(campaignId: string, reason: string) {
      const rows = await db
        .update(campaigns)
        .set({
          status: "paused",
          pausedReason: reason,
          pausedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, campaignId))
        .returning();
      return rows[0] ?? null;
    },

    async recordEvent(entry: {
      workspaceId: string;
      ruleId: string;
      campaignId: string | null;
      metricValue: number;
      actionTaken: string;
    }) {
      const rows = await db.insert(autoPauseEvents).values(entry).returning();
      return rows[0]!;
    },

    async markRuleFired(id: string) {
      await db
        .update(autoPauseRules)
        .set({ lastFiredAt: new Date() })
        .where(eq(autoPauseRules.id, id));
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
      await db.insert(activities).values({ ...entry, meta: entry.meta ?? {} });
    },
  };
}

export type AutoPauseRepository = ReturnType<typeof createAutoPauseRepository>;
export { inArray };
