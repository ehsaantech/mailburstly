import { and, eq, inArray, sql } from "drizzle-orm";
import {
  activities,
  webhooks,
  webhookDeliveries,
  type Database,
} from "@mailrung/db";

export type WebhookRow = typeof webhooks.$inferSelect;

export function createOutboundWebhookRepository({ db }: { db: Database }) {
  return {
    /** Every active webhook that wants this event. */
    async activeForEvent(workspaceId: string, event: string) {
      const rows = await db
        .select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.workspaceId, workspaceId),
            eq(webhooks.active, 1),
            sql`(${webhooks.events} IS NULL OR ${webhooks.events} = '[]'::jsonb OR ${webhooks.events} @> ${JSON.stringify([event])}::jsonb)`,
          ),
        );
      return rows;
    },

    async recordDelivery(entry: {
      webhookId: string;
      event: string;
      payload: Record<string, unknown>;
    }) {
      const rows = await db
        .insert(webhookDeliveries)
        .values({
          webhookId: entry.webhookId,
          event: entry.event,
          payload: entry.payload,
          status: "pending",
          attempts: 1,
        })
        .returning();
      return rows[0]!;
    },

    async markDelivered(id: string, statusCode: number) {
      await db
        .update(webhookDeliveries)
        .set({ status: "delivered", statusCode })
        .where(eq(webhookDeliveries.id, id));
    },

    async markFailed(id: string, statusCode: number | null, error: string) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", statusCode, error })
        .where(eq(webhookDeliveries.id, id));
    },

    async touchWebhook(id: string) {
      await db
        .update(webhooks)
        .set({ lastDeliveryAt: new Date() })
        .where(eq(webhooks.id, id));
    },

    /** Activities that have not been delivered to any webhook yet. */
    async pendingActivityTypes(workspaceId: string) {
      const rows = await db
        .selectDistinct({ type: activities.type })
        .from(activities)
        .where(eq(activities.workspaceId, workspaceId));
      return rows.map((r) => r.type);
    },

    async recentDeliveries(workspaceId: string, limit = 50) {
      return db
        .select({
          delivery: webhookDeliveries,
          webhookName: webhooks.name,
          webhookUrl: webhooks.url,
        })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(eq(webhooks.workspaceId, workspaceId))
        .orderBy(sql`${webhookDeliveries.createdAt} DESC`)
        .limit(limit);
    },
  };
}

export type OutboundWebhookRepository = ReturnType<
  typeof createOutboundWebhookRepository
>;
export { inArray };
