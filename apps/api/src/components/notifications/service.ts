import type { DbHandle } from "@/db";
import { createNotificationRepository } from "./repository";

export function createNotificationService(deps: { db: DbHandle; workspaceId: string | (() => Promise<string>) }) {
  const repository = createNotificationRepository({ db: deps.db.db });
  const ws = async () => (typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId);

  return {
    async list(userId: string, query: { unreadOnly?: boolean; limit?: number; offset?: number }) {
      const workspaceId = await ws();
      const items = await repository.list(workspaceId, userId, query.limit ?? 30, query.offset ?? 0, query.unreadOnly ?? false);
      return items;
    },
    async unreadCount(userId: string) {
      const workspaceId = await ws();
      return repository.unreadCount(workspaceId, userId);
    },
    async markRead(userId: string, id: string) {
      const workspaceId = await ws();
      await repository.markRead(workspaceId, id, userId);
    },
    async markAllRead(userId: string) {
      const workspaceId = await ws();
      await repository.markAllRead(workspaceId, userId);
    },
  };
}
