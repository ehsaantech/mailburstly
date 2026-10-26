import { and, desc, eq, sql } from "drizzle-orm";
import {
  apiKeys,
  webhooks,
  webhookDeliveries,
  type Database,
} from "@mailrung/db";

export function createWebhookRepository({ db }: { db: Database }) {
  return {
    async list(workspaceId: string) {
      return db
        .select()
        .from(webhooks)
        .where(eq(webhooks.workspaceId, workspaceId))
        .orderBy(desc(webhooks.createdAt));
    },

    async byId(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(webhooks)
        .where(
          and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.id, id)),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(entry: {
      workspaceId: string;
      name: string;
      url: string;
      secret: string;
      events: string[];
      active: boolean;
    }) {
      const rows = await db
        .insert(webhooks)
        .values({
          workspaceId: entry.workspaceId,
          name: entry.name,
          url: entry.url,
          secret: entry.secret,
          events: entry.events,
          active: entry.active ? 1 : 0,
        })
        .returning();
      return rows[0]!;
    },

    async update(id: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(webhooks)
        .set(patch)
        .where(eq(webhooks.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async remove(id: string) {
      await db.delete(webhooks).where(eq(webhooks.id, id));
    },

    async deliveries(workspaceId: string, limit: number) {
      return db
        .select({
          delivery: webhookDeliveries,
          webhookName: webhooks.name,
          webhookUrl: webhooks.url,
        })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(eq(webhooks.workspaceId, workspaceId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit);
    },

    /* ----------------------------- api keys ----------------------------- */

    async listApiKeys(workspaceId: string) {
      return db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.workspaceId, workspaceId))
        .orderBy(desc(apiKeys.createdAt));
    },

    async createApiKey(entry: {
      workspaceId: string;
      name: string;
      prefix: string;
      keyHash: string;
    }) {
      const rows = await db.insert(apiKeys).values(entry).returning();
      return rows[0]!;
    },

    async apiKeyByHash(keyHash: string) {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.active, 1)),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async touchApiKey(id: string) {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, id));
    },

    async revokeApiKey(id: string) {
      await db
        .update(apiKeys)
        .set({ active: 0 })
        .where(eq(apiKeys.id, id));
    },

    async countApiKeys(workspaceId: string) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(eq(apiKeys.workspaceId, workspaceId));
      return rows[0]?.count ?? 0;
    },
  };
}

export type WebhookRepository = ReturnType<typeof createWebhookRepository>;
