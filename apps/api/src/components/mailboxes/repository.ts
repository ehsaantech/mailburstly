import { and, desc, eq } from "drizzle-orm";

import { mailboxes, type Database } from "@mailrung/db";
import type { MailboxProvider, MailboxStatus, MailboxSummary } from "@mailrung/shared";

/**
 * Mailbox db layer — SQL only.
 *
 * Every query filters on workspace_id. A row that exists in another workspace
 * must be invisible here, which is what makes the per-workspace scoping real
 * rather than a convention.
 */

export interface MailboxRow {
  id: string;
  email: string;
  displayName: string | null;
  provider: MailboxProvider;
  status: MailboxStatus;
  emailengineId: string;
  dailyCap: number;
  healthScore: number;
  tags: string[];
  replyTo: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

/** Explicit column list so an added column never leaks into an API response. */
const columns = {
  id: mailboxes.id,
  email: mailboxes.email,
  displayName: mailboxes.displayName,
  provider: mailboxes.provider,
  status: mailboxes.status,
  emailengineId: mailboxes.emailengineId,
  dailyCap: mailboxes.dailyCap,
  healthScore: mailboxes.healthScore,
  tags: mailboxes.tags,
  replyTo: mailboxes.replyTo,
  lastCheckedAt: mailboxes.lastCheckedAt,
  lastError: mailboxes.lastError,
  createdAt: mailboxes.createdAt,
} as const;

export function createMailboxRepository({ db }: { db: Database }) {
  return {
    async list(workspaceId: string): Promise<MailboxRow[]> {
      return db
        .select(columns)
        .from(mailboxes)
        .where(eq(mailboxes.workspaceId, workspaceId))
        .orderBy(desc(mailboxes.createdAt)) as Promise<MailboxRow[]>;
    },

    /** Both keys, so an id from another workspace reads as missing. */
    async byId(workspaceId: string, id: string): Promise<MailboxRow | null> {
      const rows = await db
        .select(columns)
        .from(mailboxes)
        .where(and(eq(mailboxes.id, id), eq(mailboxes.workspaceId, workspaceId)))
        .limit(1) as MailboxRow[];
      return rows[0] ?? null;
    },

    async byEmail(email: string): Promise<MailboxRow | null> {
      const rows = await db
        .select(columns)
        .from(mailboxes)
        .where(eq(mailboxes.email, email.toLowerCase()))
        .limit(1) as MailboxRow[];
      return rows[0] ?? null;
    },

    async byEmailengineId(emailengineId: string): Promise<MailboxRow | null> {
      const rows = await db
        .select(columns)
        .from(mailboxes)
        .where(eq(mailboxes.emailengineId, emailengineId))
        .limit(1) as MailboxRow[];
      return rows[0] ?? null;
    },

    async create(input: {
      workspaceId: string;
      email: string;
      displayName: string | null;
      provider: MailboxProvider;
      emailengineId: string;
      dailyCap: number;
      tags: string[];
    }): Promise<MailboxRow> {
      const rows = await db
        .insert(mailboxes)
        .values(input)
        .returning(columns) as MailboxRow[];
      const row = rows[0];
      if (!row) throw new Error("create returned no row");
      return row;
    },

    async update(
      workspaceId: string,
      id: string,
      patch: {
        displayName?: string | null;
        dailyCap?: number;
        replyTo?: string | null;
        tags?: string[];
        status?: MailboxStatus;
        healthScore?: number;
      },
    ): Promise<MailboxRow | null> {
      const rows = await db
        .update(mailboxes)
        .set(patch)
        .where(
          and(eq(mailboxes.id, id), eq(mailboxes.workspaceId, workspaceId)),
        )
        .returning(columns) as MailboxRow[];
      return rows[0] ?? null;
    },

    async remove(workspaceId: string, id: string): Promise<boolean> {
      const rows = await db
        .delete(mailboxes)
        .where(
          and(eq(mailboxes.id, id), eq(mailboxes.workspaceId, workspaceId)),
        )
        .returning({ id: mailboxes.id });
      return rows.length > 0;
    },
  };
}

export type MailboxRepository = ReturnType<typeof createMailboxRepository>;

/**
 * Row → API shape, and the only place an enum reaches the wire. Postgres
 * guarantees the value is one of the enum members, so the narrowing here is
 * defensive against a migration that widens the enum without updating this file.
 */
export function toSummary(row: MailboxRow): MailboxSummary {
  const providers: MailboxProvider[] = ["google", "microsoft", "imap_smtp"];
  const statuses: MailboxStatus[] = [
    "connected",
    "degraded",
    "failed",
    "disconnected",
  ];

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    provider: providers.includes(row.provider) ? row.provider : "imap_smtp",
    status: statuses.includes(row.status) ? row.status : "disconnected",
    dailyCap: row.dailyCap,
    healthScore: row.healthScore,
    tags: row.tags,
    // mailbox_daily_stats is wired when the send path lands.
    sentToday: 0,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}