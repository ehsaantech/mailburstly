import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  campaignLeads,
  campaigns,
  leads,
  type Database,
} from "@mailrung/db";

export function createPublicRepository({ db }: { db: Database }) {
  return {
    async listCampaigns(workspaceId: string, limit: number, offset: number) {
      const rows = await db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          status: campaigns.status,
          createdAt: campaigns.createdAt,
          launchedAt: campaigns.launchedAt,
          enrolled: sql<number>`(
            SELECT count(*)::int FROM campaign_leads
            WHERE campaign_leads.campaign_id = ${campaigns.id}
          )`,
        })
        .from(campaigns)
        .where(eq(campaigns.workspaceId, workspaceId))
        .orderBy(desc(campaigns.createdAt))
        .limit(limit)
        .offset(offset);

      const total = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaigns)
        .where(eq(campaigns.workspaceId, workspaceId));

      return { items: rows, total: total[0]?.count ?? 0 };
    },

    async listLeads(
      workspaceId: string,
      query: { limit: number; offset: number; statusId?: number; search?: string },
    ) {
      const conditions = [eq(leads.workspaceId, workspaceId)];
      if (query.statusId) conditions.push(eq(leads.statusId, query.statusId));
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
          id: leads.id,
          email: leads.email,
          firstName: leads.firstName,
          lastName: leads.lastName,
          company: leads.company,
          title: leads.title,
          emailStatus: leads.emailStatus,
          statusId: leads.statusId,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(and(...conditions))
        .orderBy(desc(leads.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      const total = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(...conditions));

      return { items: rows, total: total[0]?.count ?? 0 };
    },

    async leadCampaigns(workspaceId: string, leadId: string) {
      return db
        .select({
          campaignId: campaigns.id,
          campaignName: campaigns.name,
          state: campaignLeads.state,
          stoppedReason: campaignLeads.stoppedReason,
          lastSentAt: campaignLeads.lastSentAt,
        })
        .from(campaignLeads)
        .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
        .where(
          and(
            eq(campaignLeads.leadId, leadId),
            eq(campaigns.workspaceId, workspaceId),
          ),
        );
    },
  };
}

export type PublicRepository = ReturnType<typeof createPublicRepository>;
