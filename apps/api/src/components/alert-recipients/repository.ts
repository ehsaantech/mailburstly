import { and, asc, eq } from "drizzle-orm";
import { alertRecipients, type Database } from "@mailrung/db";

/** One row of `alert_recipients`, as the api reports it. */
export interface AlertRecipientRow {
  id: string;
  email: string;
  name: string | null;
  severity: "error" | "warning";
  enabled: boolean;
  createdAt: Date;
}

export interface CreateAlertRecipientRecord {
  email: string;
  name?: string | null;
  severity: "error" | "warning";
  enabled: boolean;
}

export interface UpdateAlertRecipientRecord {
  name?: string | null;
  severity?: "error" | "warning";
  enabled?: boolean;
}

export function createAlertRecipientsRepository({ db }: { db: Database }) {
  const columns = {
    id: alertRecipients.id,
    email: alertRecipients.email,
    name: alertRecipients.name,
    severity: alertRecipients.severity,
    enabled: alertRecipients.enabled,
    createdAt: alertRecipients.createdAt,
  };

  return {
    async list(workspaceId: string): Promise<AlertRecipientRow[]> {
      return db
        .select(columns)
        .from(alertRecipients)
        .where(eq(alertRecipients.workspaceId, workspaceId))
        .orderBy(asc(alertRecipients.createdAt));
    },

    async byId(
      workspaceId: string,
      id: string,
    ): Promise<AlertRecipientRow | null> {
      const rows = await db
        .select(columns)
        .from(alertRecipients)
        .where(
          and(
            eq(alertRecipients.id, id),
            eq(alertRecipients.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(
      workspaceId: string,
      input: CreateAlertRecipientRecord,
    ): Promise<AlertRecipientRow> {
      const rows = await db
        .insert(alertRecipients)
        .values({
          workspaceId,
          email: input.email,
          name: input.name ?? null,
          severity: input.severity,
          enabled: input.enabled,
        })
        .returning(columns);
      return rows[0]!;
    },

    async update(
      workspaceId: string,
      id: string,
      input: UpdateAlertRecipientRecord,
    ): Promise<AlertRecipientRow | null> {
      const rows = await db
        .update(alertRecipients)
        .set(input)
        .where(
          and(
            eq(alertRecipients.id, id),
            eq(alertRecipients.workspaceId, workspaceId),
          ),
        )
        .returning(columns);
      return rows[0] ?? null;
    },

    async remove(workspaceId: string, id: string): Promise<boolean> {
      const rows = await db
        .delete(alertRecipients)
        .where(
          and(
            eq(alertRecipients.id, id),
            eq(alertRecipients.workspaceId, workspaceId),
          ),
        )
        .returning({ id: alertRecipients.id });
      return rows.length > 0;
    },
  };
}

export type AlertRecipientsRepository = ReturnType<
  typeof createAlertRecipientsRepository
>;
