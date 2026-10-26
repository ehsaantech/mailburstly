import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  activities,
  campaignLeads,
  campaignMailboxes,
  campaignSteps,
  campaigns,
  leads,
  leadLabels,
  mailboxes,
  opportunities,
  sendJobs,
  stepVariants,
  type Database,
} from "@mailrung/db";

export type CampaignRow = typeof campaigns.$inferSelect;
export type CampaignStepRow = typeof campaignSteps.$inferSelect;
export type StepVariantRow = typeof stepVariants.$inferSelect;
export type CampaignLeadRow = typeof campaignLeads.$inferSelect;

export function createCampaignRepository({ db }: { db: Database }) {
  return {
    async list(workspaceId: string) {
      return db.select().from(campaigns).where(eq(campaigns.workspaceId, workspaceId));
    },

    async byId(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: {
      workspaceId: string;
      name: string;
      dailyLimit?: number | null;
      dailyMaxLeads?: number | null;
      emailGapMinutes: number;
      randomWaitMax: number;
      stopOnReply: boolean;
      stopOnAutoReply: boolean;
      stopForCompany: boolean;
      openTracking: boolean;
      linkTracking: boolean;
      textOnly: boolean;
      insertUnsubscribeHeader: boolean;
      allowRiskyContacts: boolean;
      schedule: unknown;
      ownerId?: string | null;
    }) {
      const [row] = await db
        .insert(campaigns)
        .values(input)
        .returning();
      if (!row) throw new Error("campaign insert returned no row");
      return row;
    },

    async update(workspaceId: string, id: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(campaigns)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)))
        .returning();
      return rows[0] ?? null;
    },

    async remove(workspaceId: string, id: string) {
      const rows = await db
        .delete(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)))
        .returning({ id: campaigns.id });
      return rows.length > 0;
    },

    // --- Steps ---

    async listSteps(campaignId: string) {
      return db
        .select()
        .from(campaignSteps)
        .where(eq(campaignSteps.campaignId, campaignId))
        .orderBy(campaignSteps.position);
    },

    async getStep(campaignId: string, stepId: string) {
      const rows = await db
        .select()
        .from(campaignSteps)
        .where(and(eq(campaignSteps.id, stepId), eq(campaignSteps.campaignId, campaignId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async createStep(input: {
      campaignId: string;
      subject?: string | null;
      bodyHtml: string;
      bodyText?: string | null;
      preheader?: string | null;
      delayMinutes: number;
      threadMode: string;
      position: number;
    }) {
      const [row] = await db
        .insert(campaignSteps)
        .values({
          ...input,
          threadMode: input.threadMode as "reply" | "new_thread",
        })
        .returning();
      if (!row) throw new Error("step insert returned no row");
      return row;
    },

    async updateStep(campaignId: string, stepId: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(campaignSteps)
        .set(patch)
        .where(and(eq(campaignSteps.id, stepId), eq(campaignSteps.campaignId, campaignId)))
        .returning();
      return rows[0] ?? null;
    },

    async removeStep(campaignId: string, stepId: string) {
      const rows = await db
        .delete(campaignSteps)
        .where(and(eq(campaignSteps.id, stepId), eq(campaignSteps.campaignId, campaignId)))
        .returning({ id: campaignSteps.id });
      return rows.length > 0;
    },

    /** A lead's merge variables, for a preview or a test send. */
    async leadById(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** A mailbox by its id. */
    async mailboxById(id: string) {
      const rows = await db
        .select({
          id: mailboxes.id,
          email: mailboxes.email,
          emailengineId: mailboxes.emailengineId,
        })
        .from(mailboxes)
        .where(eq(mailboxes.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Any connected mailbox, for a test send when the campaign has none. */
    async anyConnectedMailbox() {
      const rows = await db
        .select({
          id: mailboxes.id,
          email: mailboxes.email,
          emailengineId: mailboxes.emailengineId,
        })
        .from(mailboxes)
        .where(eq(mailboxes.status, "connected"))
        .limit(1);
      return rows[0] ?? null;
    },

    async listVariants(stepId: string) {
      return db.select().from(stepVariants).where(eq(stepVariants.stepId, stepId));
    },

    async createVariant(input: {
      stepId: string;
      label: string;
      subject?: string | null;
      bodyHtml: string;
      weight: number;
      pinned: boolean;
    }) {
      const [row] = await db
        .insert(stepVariants)
        .values({
          ...input,
          pinned: input.pinned ? 1 : 0,
        })
        .returning();
      if (!row) throw new Error("variant insert returned no row");
      return row;
    },

    async updateVariant(stepId: string, variantId: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(stepVariants)
        .set(patch)
        .where(and(eq(stepVariants.id, variantId), eq(stepVariants.stepId, stepId)))
        .returning();
      return rows[0] ?? null;
    },

    async removeVariant(stepId: string, variantId: string) {
      const rows = await db
        .delete(stepVariants)
        .where(and(eq(stepVariants.id, variantId), eq(stepVariants.stepId, stepId)))
        .returning({ id: stepVariants.id });
      return rows.length > 0;
    },

    /**
     * Reorders the steps of a campaign.
     *
     * The positions are swapped out in a transaction, and the unique index
     * on (campaign_id, position) would reject a naive update that moved one
     * step onto another's position. Shifting every position into a negative
     * range first avoids the collision entirely.
     */
    async reorderSteps(campaignId: string, stepIds: string[]) {
      await db.transaction(async (tx) => {
        // Park every step out of the way.
        await tx
          .update(campaignSteps)
          .set({ position: sql`-1 - ${campaignSteps.position}` })
          .where(eq(campaignSteps.campaignId, campaignId));

        let position = 1;
        for (const stepId of stepIds) {
          await tx
            .update(campaignSteps)
            .set({ position })
            .where(
              and(
                eq(campaignSteps.id, stepId),
                eq(campaignSteps.campaignId, campaignId),
              ),
            );
          position++;
        }
      });
    },

    // --- Enrollment ---

    async enrollLeads(campaignId: string, leadIds: string[]) {
      const values = leadIds.map((leadId) => ({
        campaignId,
        leadId,
        state: "active" as const,
      }));
      // ON CONFLICT DO NOTHING — skip already-enrolled leads
      await db.insert(campaignLeads).values(values).onConflictDoNothing();
    },

    async listCampaignLeads(campaignId: string, limit = 50, offset = 0) {
      return db
        .select({
          id: campaignLeads.id,
          campaignId: campaignLeads.campaignId,
          leadId: leads.id,
          currentStepId: campaignLeads.currentStepId,
          state: campaignLeads.state,
          stoppedReason: campaignLeads.stoppedReason,
          nextStepAt: campaignLeads.nextStepAt,
          lastSentAt: campaignLeads.lastSentAt,
          variantAssignments: campaignLeads.variantAssignments,
          pausedUntil: campaignLeads.pausedUntil,
          enteredAt: campaignLeads.enteredAt,
          completedAt: campaignLeads.completedAt,
          email: leads.email,
          firstName: leads.firstName,
          lastName: leads.lastName,
          company: leads.company,
          title: leads.title,
          statusId: leads.statusId,
          emailStatus: leads.emailStatus,
          lastActivityAt: leads.lastActivityAt,
        })
        .from(campaignLeads)
        .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
        .where(eq(campaignLeads.campaignId, campaignId))
        .limit(limit)
        .offset(offset);
    },

    /**
     * Lead and step counts for many campaigns in one round trip.
     *
     * The list view needs a count per campaign. Doing that per-campaign turns
     * the list into an N+1 query storm, so we group in SQL instead.
     */
    /**
     * The engagement numbers for the campaigns list.
     *
     * One grouped query for every campaign, so the list does not fan out
     * into a query per row.
     */
    async funnelsForCampaigns(
      campaignIds: string[],
      from: string,
      to: string,
    ): Promise<
      Map<
        string,
        {
          sent: number;
          contacted: number;
          opened: number;
          clicked: number;
          replied: number;
          positiveReplies: number;
          opportunities: number;
          opportunityValue: number;
          bounced: number;
        }
      >
    > {
      const out = new Map<
        string,
        {
          sent: number;
          contacted: number;
          opened: number;
          clicked: number;
          replied: number;
          positiveReplies: number;
          opportunities: number;
          opportunityValue: number;
          bounced: number;
        }
      >();
      if (campaignIds.length === 0) return out;

      const rows = await db
        .select({
          campaignId: activities.campaignId,
          sent: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          contacted: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          opened: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_opened')::int`,
          clicked: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'link_clicked')::int`,
          replied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'reply_received')::int`,
          bounced: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'bounced')::int`,
        })
        .from(activities)
        .where(
          and(
            inArray(activities.campaignId, campaignIds),
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
          ),
        )
        .groupBy(activities.campaignId);

      const positiveRows = await db
        .select({
          campaignId: campaignLeads.campaignId,
          count: sql<number>`count(DISTINCT ${campaignLeads.leadId})::int`,
        })
        .from(campaignLeads)
        .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
        .innerJoin(leadLabels, eq(leadLabels.id, leads.statusId))
        .where(
          and(
            inArray(campaignLeads.campaignId, campaignIds),
            eq(leadLabels.interest, "positive"),
          ),
        )
        .groupBy(campaignLeads.campaignId);

      const opportunityRows = await db
        .select({
          campaignId: opportunities.campaignId,
          count: sql<number>`count(*)::int`,
          value: sql<number>`coalesce(sum(${opportunities.value}), 0)::int`,
        })
        .from(opportunities)
        .where(inArray(opportunities.campaignId, campaignIds))
        .groupBy(opportunities.campaignId);

      const positiveMap = new Map(
        positiveRows.map((r) => [r.campaignId as string, r.count]),
      );
      const opportunityMap = new Map(
        opportunityRows.map((r) => [
          r.campaignId as string,
          { count: r.count, value: r.value },
        ]),
      );

      for (const id of campaignIds) {
        const row = rows.find((r) => r.campaignId === id);
        const opp = opportunityMap.get(id);
        out.set(id, {
          sent: row?.sent ?? 0,
          contacted: row?.contacted ?? 0,
          opened: row?.opened ?? 0,
          clicked: row?.clicked ?? 0,
          replied: row?.replied ?? 0,
          positiveReplies: positiveMap.get(id) ?? 0,
          opportunities: opp?.count ?? 0,
          opportunityValue: opp?.value ?? 0,
          bounced: row?.bounced ?? 0,
        });
      }

      return out;
    },

    /**
     * The share of each campaign's enrolled leads who finished the whole
     * sequence. A lead who answered the first email and stopped is not
     * half-way through.
     */
    async progressForCampaigns(campaignIds: string[]) {
      const out = new Map<string, number>();
      if (campaignIds.length === 0) return out;

      const rows = await db
        .select({
          campaignId: campaignLeads.campaignId,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) FILTER (WHERE ${campaignLeads.state} = 'completed')::int`,
        })
        .from(campaignLeads)
        .where(inArray(campaignLeads.campaignId, campaignIds))
        .groupBy(campaignLeads.campaignId);

      for (const row of rows) {
        out.set(
          row.campaignId,
          row.total === 0
            ? 0
            : Math.round((row.completed / row.total) * 100),
        );
      }

      return out;
    },

    async countsForCampaigns(campaignIds: string[]) {
      if (campaignIds.length === 0) return new Map<string, { leadCount: number; stepCount: number }>();

      const leadRows = await db
        .select({
          campaignId: campaignLeads.campaignId,
          count: sql<number>`count(*)::int`,
        })
        .from(campaignLeads)
        .where(inArray(campaignLeads.campaignId, campaignIds))
        .groupBy(campaignLeads.campaignId);

      const stepRows = await db
        .select({
          campaignId: campaignSteps.campaignId,
          count: sql<number>`count(*)::int`,
        })
        .from(campaignSteps)
        .where(inArray(campaignSteps.campaignId, campaignIds))
        .groupBy(campaignSteps.campaignId);

      const leadMap = new Map(leadRows.map((r) => [r.campaignId, r.count]));
      const stepMap = new Map(stepRows.map((r) => [r.campaignId, r.count]));

      const out = new Map<string, { leadCount: number; stepCount: number }>();
      for (const id of campaignIds) {
        out.set(id, {
          leadCount: leadMap.get(id) ?? 0,
          stepCount: stepMap.get(id) ?? 0,
        });
      }
      return out;
    },

    async countCampaignLeads(campaignId: string) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaignLeads)
        .where(eq(campaignLeads.campaignId, campaignId));
      return rows[0]?.count ?? 0;
    },

    // --- Send jobs (for scheduler) ---

    // --- Mailbox assignment ---

    async listAssignedMailboxIds(campaignId: string): Promise<string[]> {
      const rows = await db
        .select({ mailboxId: campaignMailboxes.mailboxId })
        .from(campaignMailboxes)
        .where(eq(campaignMailboxes.campaignId, campaignId));
      return rows.map((r) => r.mailboxId);
    },

    async assignMailboxes(campaignId: string, mailboxIds: string[]): Promise<void> {
      await db
        .delete(campaignMailboxes)
        .where(eq(campaignMailboxes.campaignId, campaignId));
      if (mailboxIds.length === 0) return;
      await db
        .insert(campaignMailboxes)
        .values(mailboxIds.map((mailboxId) => ({ campaignId, mailboxId })))
        .onConflictDoNothing();
    },

    async createSendJobs(jobs: Array<{
      campaignLeadId: string;
      stepId: string;
      variantId?: string | null;
      mailboxId: string;
      scheduledAt: Date;
    }>) {
      if (jobs.length === 0) return;
      await db.insert(sendJobs).values(
        jobs.map((j) => ({
          campaignLeadId: j.campaignLeadId,
          stepId: j.stepId,
          variantId: j.variantId ?? null,
          mailboxId: j.mailboxId,
          scheduledAt: j.scheduledAt,
          state: "pending",
        })),
      );
    },

    async listPendingDue(limit = 500) {
      return db
        .select()
        .from(sendJobs)
        .where(eq(sendJobs.state, "pending"))
        .orderBy(sendJobs.scheduledAt)
        .limit(limit);
    },
  };
}

export type CampaignRepository = ReturnType<typeof createCampaignRepository>;