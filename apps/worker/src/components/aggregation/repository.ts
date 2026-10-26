import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  activities,
  campaignDailyStats,
  type Database,
} from "@mailrung/db";

export function createAggregationRepository({ db }: { db: Database }) {
  return {
    /**
     * Every scope with activity, in one pass.
     *
     * Grouping by (date, step, variant) in a single query is what makes the
     * backfill affordable: the campaign total, the per-step totals and the
     * per-variant totals are all sums over these rows, so one query replaces
     * two per campaign *per day*. A 90-day backfill over ten campaigns is
     * thirty queries, not eighteen hundred.
     */
    async scopesFor(
      campaignId: string,
      from: string,
      to: string,
    ): Promise<
      Array<{
        date: string;
        stepId: string | null;
        variantId: string | null;
        sent: number;
        opened: number;
        clicked: number;
        replied: number;
        autoReplied: number;
        bounced: number;
        unsubscribed: number;
      }>
    > {
      return db
        .select({
          date: sql<string>`${activities.createdAt}::date::text`,
          stepId: activities.stepId,
          variantId: activities.variantId,
          sent: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          opened: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_opened')::int`,
          clicked: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'link_clicked')::int`,
          replied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'reply_received')::int`,
          autoReplied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'auto_reply')::int`,
          bounced: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'bounced')::int`,
          unsubscribed: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'unsubscribed')::int`,
        })
        .from(activities)
        .where(
          and(
            eq(activities.campaignId, campaignId),
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
          ),
        )
        .groupBy(
          sql`${activities.createdAt}::date`,
          activities.stepId,
          activities.variantId,
        );
    },

    /**
     * Write the counters for one scope, replacing whatever was there.
     *
     * The rollup is a recomputation, not an increment, so a row that no
     * longer has activity behind it is cleared rather than left stale.
     */
    async upsert(entry: {
      workspaceId: string;
      campaignId: string;
      stepId: string | null;
      variantId: string | null;
      date: string;
      counters: {
        sent: number;
        delivered: number;
        opened: number;
        clicked: number;
        replied: number;
        autoReplied: number;
        bounced: number;
        unsubscribed: number;
      };
    }) {
      await db
        .insert(campaignDailyStats)
        .values({
          workspaceId: entry.workspaceId,
          campaignId: entry.campaignId,
          stepId: entry.stepId,
          variantId: entry.variantId,
          date: entry.date,
          ...entry.counters,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            campaignDailyStats.campaignId,
            campaignDailyStats.stepId,
            campaignDailyStats.variantId,
            campaignDailyStats.date,
          ],
          set: {
            ...entry.counters,
            updatedAt: new Date(),
          },
        });
    },

    /** Campaigns with any activity in the window, and their workspace. */
    async campaignsInWindow(from: string, to: string) {
      return db
        .selectDistinct({
          campaignId: activities.campaignId,
          workspaceId: activities.workspaceId,
        })
        .from(activities)
        .where(
          and(
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
            sql`${activities.campaignId} IS NOT NULL`,
          ),
        );
    },
  };
}

export type AggregationRepository = ReturnType<typeof createAggregationRepository>;
