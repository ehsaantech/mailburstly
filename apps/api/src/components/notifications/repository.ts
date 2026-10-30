import { and, eq, sql } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { notifications } from "@mailrung/db";

export function createNotificationRepository({ db }: { db: DbHandle["db"] }) {
  return {
    async list(workspaceId: string, userId: string, limit = 30, offset = 0, unreadOnly = false) {
      const conditions = [
        sql`${notifications.workspaceId} = ${workspaceId}`,
        sql`${notifications.userId} = ${userId}`,
      ];
      if (unreadOnly) conditions.push(sql`${notifications.readAt} IS NULL`);
      return db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(sql`${notifications.createdAt} DESC`)
        .limit(limit)
        .offset(offset);
    },
    async unreadCount(workspaceId: string, userId: string) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            sql`${notifications.workspaceId} = ${workspaceId}`,
            sql`${notifications.userId} = ${userId}`,
            sql`${notifications.readAt} IS NULL`,
          ),
        );
      return rows[0]?.count ?? 0;
    },
    async create(rows: Array<any>) {
      if (rows.length === 0) return [];
      const inserted = await db.insert(notifications).values(rows).onConflictDoNothing({ target: notifications.dedupeKey }).returning();
      return inserted;
    },
    async markRead(workspaceId: string, id: string, userId: string) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.userId, userId),
            eq(notifications.workspaceId, workspaceId),
          ),
        );
    },
    async markAllRead(workspaceId: string, userId: string) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.userId, userId),
            sql`${notifications.readAt} IS NULL`,
          ),
        );
    },
  };
}