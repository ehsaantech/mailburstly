import { asc, eq } from "drizzle-orm";

import { workspaces, type Database } from "@mailrung/db";
import type { WorkspaceSummary } from "@mailrung/shared";

/**
 * Workspace db layer.
 *
 * The product is single-tenant for now, so "resolve the workspace for this
 * request" is just "read the one row". Every domain table already carries
 * workspace_id, so when multi-tenant arrives only this module changes.
 */

export type WorkspaceRepository = ReturnType<typeof createWorkspaceRepository>;

/**
 * Single-tenant for now: "resolve the workspace for this request" is just
 * "read the one row". Every domain table already carries workspace_id, so
 * when multi-tenancy arrives only this module changes.
 */
export function createWorkspaceRepository({ db }: { db: Database }) {
  return {
    /** The one workspace. Ordered and limited so the query is deterministic. */
    async primary(): Promise<WorkspaceSummary> {
      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          timezone: workspaces.timezone,
        })
        .from(workspaces)
        .orderBy(asc(workspaces.createdAt))
        .limit(1);
      return rows[0] ?? { id: "", name: "Mailrung", timezone: "UTC" };
    },

    async name(id: string): Promise<string> {
      const rows = await db
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .limit(1);
      return rows[0]?.name ?? "Mailrung";
    },
  };
}