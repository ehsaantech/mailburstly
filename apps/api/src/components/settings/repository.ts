import { asc, eq } from "drizzle-orm";
import { workspaces, type Database } from "@mailrung/db";

export function createSettingsRepository({ db }: { db: Database }) {
  return {
    /** The one workspace's settings blob. */
    async current(): Promise<Record<string, unknown>> {
      const rows = await db
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .orderBy(asc(workspaces.createdAt))
        .limit(1);
      return (rows[0]?.settings ?? {}) as Record<string, unknown>;
    },

    async patch(
      id: string,
      settings: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const rows = await db
        .update(workspaces)
        .set({ settings })
        .where(eq(workspaces.id, id))
        .returning({ settings: workspaces.settings });
      return (rows[0]?.settings ?? {}) as Record<string, unknown>;
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
