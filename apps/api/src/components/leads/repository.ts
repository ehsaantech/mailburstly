import { and, eq, ilike, or, sql } from "drizzle-orm";
import {
  leads,
  leadLabels,
  type Database,
} from "@mailrung/db";

export type LeadRow = typeof leads.$inferSelect;

export function createLeadRepository({ db }: { db: Database }) {
  return {
    async list(workspaceId: string, query: {
      limit: number;
      offset: number;
      statusId?: number;
      emailStatus?: string;
      search?: string;
    }) {
      const conditions = [eq(leads.workspaceId, workspaceId)];
      if (query.statusId) conditions.push(eq(leads.statusId, query.statusId));
      if (query.emailStatus) conditions.push(eq(leads.emailStatus, query.emailStatus as any));
      if (query.search) {
        const term = `%${query.search}%`;
        conditions.push(
          or(
            ilike(leads.email, term),
            ilike(leads.firstName, term),
            ilike(leads.lastName, term),
            ilike(leads.company, term),
          )!,
        );
      }
      return db
        .select()
        .from(leads)
        .where(and(...conditions))
        .orderBy(leads.createdAt)
        .limit(query.limit)
        .offset(query.offset);
    },

    async count(workspaceId: string, query: {
      statusId?: number;
      emailStatus?: string;
      search?: string;
    }) {
      const conditions = [eq(leads.workspaceId, workspaceId)];
      if (query.statusId) conditions.push(eq(leads.statusId, query.statusId));
      if (query.emailStatus) conditions.push(eq(leads.emailStatus, query.emailStatus as any));
      if (query.search) {
        const term = `%${query.search}%`;
        conditions.push(
          or(
            ilike(leads.email, term),
            ilike(leads.firstName, term),
            ilike(leads.lastName, term),
            ilike(leads.company, term),
          )!,
        );
      }
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(...conditions));
      return rows[0]?.count ?? 0;
    },

    async byId(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async byEmail(workspaceId: string, email: string) {
      const rows = await db
        .select()
        .from(leads)
        .where(and(eq(leads.email, email.toLowerCase()), eq(leads.workspaceId, workspaceId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: {
      workspaceId: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      company?: string | null;
      title?: string | null;
      phone?: string | null;
      statusId?: number | null;
      customVariables?: Record<string, string>;
    }) {
      const [row] = await db
        .insert(leads)
        .values({
          workspaceId: input.workspaceId,
          email: input.email.toLowerCase(),
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          company: input.company ?? null,
          title: input.title ?? null,
          phone: input.phone ?? null,
          statusId: input.statusId ?? null,
          customVariables: input.customVariables ?? {},
        })
        .returning();
      if (!row) throw new Error("lead insert returned no row");
      return row;
    },

    async update(workspaceId: string, id: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(leads)
        .set(patch)
        .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)))
        .returning();
      return rows[0] ?? null;
    },

    async remove(workspaceId: string, id: string) {
      const rows = await db
        .delete(leads)
        .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)))
        .returning({ id: leads.id });
      return rows.length > 0;
    },

    async listLabels(workspaceId: string) {
      return db
        .select()
        .from(leadLabels)
        .where(eq(leadLabels.workspaceId, workspaceId));
    },
  };
}

export type LeadRepository = ReturnType<typeof createLeadRepository>;