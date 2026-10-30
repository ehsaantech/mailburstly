import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  campaignLeads,
  campaignLists,
  campaigns,
  leadListMembers,
  leadLists,
  leads,
  leadLabels,
  listWatchers,
  users,
  type Database,
} from "@mailrung/db";

export function createListRepository({ db }: { db: Database }) {
  return {
    /**
     * Every list, with its member count and the campaigns using it.
     *
     * The counts come from joins rather than correlated subqueries: two
     * left joins multiply the rows, so both counts are DISTINCT.
     */
    async list(workspaceId: string) {
      const rows = await db
        .select({
          list: leadLists,
          memberCount: sql<number>`count(DISTINCT ${leadListMembers.id})::int`,
          campaignCount: sql<number>`count(DISTINCT ${campaignLists.id})::int`,
        })
        .from(leadLists)
        .leftJoin(leadListMembers, eq(leadListMembers.listId, leadLists.id))
        .leftJoin(campaignLists, eq(campaignLists.listId, leadLists.id))
        .where(eq(leadLists.workspaceId, workspaceId))
        .groupBy(leadLists.id)
        .orderBy(desc(leadLists.createdAt));

      return rows;
    },

    async byId(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(leadLists)
        .where(
          and(eq(leadLists.workspaceId, workspaceId), eq(leadLists.id, id)),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async byName(workspaceId: string, name: string) {
      const rows = await db
        .select()
        .from(leadLists)
        .where(
          and(
            eq(leadLists.workspaceId, workspaceId),
            sql`lower(${leadLists.name}) = lower(${name})`,
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: {
      workspaceId: string;
      name: string;
      description: string | null;
    }) {
      const rows = await db
        .insert(leadLists)
        .values(input)
        .returning();
      return rows[0]!;
    },

    async update(
      workspaceId: string,
      id: string,
      patch: { name?: string; description?: string | null },
    ) {
      const rows = await db
        .update(leadLists)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(leadLists.workspaceId, workspaceId), eq(leadLists.id, id)),
        )
        .returning();
      return rows[0] ?? null;
    },

    async remove(workspaceId: string, id: string) {
      const rows = await db
        .delete(leadLists)
        .where(
          and(eq(leadLists.workspaceId, workspaceId), eq(leadLists.id, id)),
        )
        .returning({ id: leadLists.id });
      return rows.length > 0;
    },

    /* ----------------------------- members ------------------------------ */

    async addMembers(listId: string, leadIds: string[]) {
      if (leadIds.length === 0) return [];
      const rows = await db
        .insert(leadListMembers)
        .values(leadIds.map((leadId) => ({ listId, leadId })))
        .onConflictDoNothing()
        .returning({ leadId: leadListMembers.leadId });
      return rows.map((r) => r.leadId);
    },

    async removeMember(listId: string, leadId: string) {
      const rows = await db
        .delete(leadListMembers)
        .where(
          and(
            eq(leadListMembers.listId, listId),
            eq(leadListMembers.leadId, leadId),
          ),
        )
        .returning({ id: leadListMembers.id });
      return rows.length > 0;
    },

    async memberIds(listId: string) {
      const rows = await db
        .select({ leadId: leadListMembers.leadId })
        .from(leadListMembers)
        .where(eq(leadListMembers.listId, listId));
      return rows.map((r) => r.leadId);
    },

    /** A page of the list's leads, with their status. */
    async members(
      listId: string,
      query: { limit: number; offset: number; search?: string },
    ) {
      const conditions = [eq(leadListMembers.listId, listId)];
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
        .select({
          member: leadListMembers,
          lead: leads,
          statusName: leadLabels.name,
          statusInterest: leadLabels.interest,
        })
        .from(leadListMembers)
        .innerJoin(leads, eq(leads.id, leadListMembers.leadId))
        .leftJoin(leadLabels, eq(leadLabels.id, leads.statusId))
        .where(and(...conditions))
        .orderBy(desc(leadListMembers.addedAt))
        .limit(query.limit)
        .offset(query.offset);

      const countRows = await db
        .select({ count: count(leadListMembers.id) })
        .from(leadListMembers)
        .innerJoin(leads, eq(leads.id, leadListMembers.leadId))
        .where(and(...conditions));

      return { items: rows, total: countRows[0]?.count ?? 0 };
    },

    /** How the list's leads break down. */
    async memberBreakdown(listId: string) {
      const rows = await db
        .select({
          statusName: leadLabels.name,
          statusInterest: leadLabels.interest,
          count: sql<number>`count(*)::int`,
        })
        .from(leadListMembers)
        .innerJoin(leads, eq(leads.id, leadListMembers.leadId))
        .leftJoin(leadLabels, eq(leadLabels.id, leads.statusId))
        .where(eq(leadListMembers.listId, listId))
        .groupBy(leadLabels.name, leadLabels.interest);

      return rows;
    },

    /* ------------------------- campaign attachment ---------------------- */

    async attach(campaignId: string, listId: string) {
      const rows = await db
        .insert(campaignLists)
        .values({ campaignId, listId })
        .onConflictDoNothing()
        .returning();
      return rows.length > 0;
    },

    async detach(campaignId: string, listId: string) {
      const rows = await db
        .delete(campaignLists)
        .where(
          and(
            eq(campaignLists.campaignId, campaignId),
            eq(campaignLists.listId, listId),
          ),
        )
        .returning({ id: campaignLists.id });
      return rows.length > 0;
    },

    async listsForCampaign(campaignId: string) {
      return db
        .select({
          id: leadLists.id,
          name: leadLists.name,
          description: leadLists.description,
          memberCount: sql<number>`count(distinct ${leadListMembers.id})::int`,
        })
        .from(campaignLists)
        .innerJoin(leadLists, eq(leadLists.id, campaignLists.listId))
        .leftJoin(leadListMembers, eq(leadListMembers.listId, leadLists.id))
        .where(eq(campaignLists.campaignId, campaignId))
        .groupBy(leadLists.id, leadLists.name, leadLists.description);
    },

    /**
     * The campaigns a list is attached to, with the switch that decides
     * whether a lead added later is enrolled.
     */
    async campaignsForList(listId: string) {
      return db
        .select({
          campaignId: campaigns.id,
          name: campaigns.name,
          status: campaigns.status,
          enrollOnAdd: campaigns.enrollOnAdd,
        })
        .from(campaignLists)
        .innerJoin(campaigns, eq(campaigns.id, campaignLists.campaignId))
        .where(eq(campaignLists.listId, listId));
    },

    /**
     * Enrolls leads in a campaign, skipping the ones already in it.
     */
    async enroll(campaignId: string, leadIds: string[]) {
      if (leadIds.length === 0) return 0;
      const rows = await db
        .insert(campaignLeads)
        .values(
          leadIds.map((leadId) => ({
            campaignId,
            leadId,
            state: "active" as const,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: campaignLeads.id });
      return rows.length;
    },

    async listWatchers(listId: string) {
      return db
        .select({
          userId: listWatchers.userId,
          inApp: listWatchers.inApp,
          email: listWatchers.email,
          name: users.name,
          emailAddr: users.email,
        })
        .from(listWatchers)
        .innerJoin(users, eq(users.id, listWatchers.userId))
        .where(eq(listWatchers.listId, listId));
    },

    async replaceWatchers(listId: string, userIds: string[]) {
      await db.delete(listWatchers).where(eq(listWatchers.listId, listId));
      if (userIds.length === 0) return [];
      return db
        .insert(listWatchers)
        .values(userIds.map((userId) => ({ listId, userId })))
        .returning();
    },
  };
}

export type ListRepository = ReturnType<typeof createListRepository>;
