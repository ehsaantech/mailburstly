import { and, eq, sql } from "drizzle-orm";
import {
  blocklist,
  campaignLeads,
  campaignMailboxes,
  campaignSteps,
  campaigns,
  leads,
  mailboxes,
  messages,
  sendJobs,
  stepVariants,
  workspaces,
  type Database,
} from "@mailrung/db";

export function createSchedulerRepository({ db }: { db: Database }) {
  return {
    async activeCampaigns() {
      return db
        .select()
        .from(campaigns)
        .where(eq(campaigns.status, "active"));
    },

    async enrolledLeads(campaignId: string) {
      return db
        .select()
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.campaignId, campaignId),
            eq(campaignLeads.state, "active"),
          ),
        );
    },

    async stepsForCampaign(campaignId: string) {
      return db
        .select()
        .from(campaignSteps)
        .where(eq(campaignSteps.campaignId, campaignId))
        .orderBy(campaignSteps.position);
    },

    async variantsForStep(stepId: string) {
      return db
        .select()
        .from(stepVariants)
        .where(eq(stepVariants.stepId, stepId));
    },

    async leadById(leadId: string) {
      const rows = await db
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1);
      return rows[0] ?? null;
    },

    async mailboxById(mailboxId: string) {
      const rows = await db
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.id, mailboxId))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Mailboxes this campaign may send from.
     *
     * Falls back to every connected mailbox when the campaign has no explicit
     * assignment, so a campaign works out of the box — but when a team
     * assigns mailboxes explicitly, those are the only ones used. That matters
     * for multi-client setups where one client's campaign must never send
     * from another client's mailbox.
     */
    async mailboxesForCampaign(campaignId: string) {
      const assigned = await db
        .select({
          id: mailboxes.id,
          email: mailboxes.email,
          status: mailboxes.status,
        })
        .from(campaignMailboxes)
        .innerJoin(mailboxes, eq(mailboxes.id, campaignMailboxes.mailboxId))
        .where(eq(campaignMailboxes.campaignId, campaignId));

      if (assigned.length > 0) {
        return assigned.map((m) => ({ ...m, status: m.status as "connected" }));
      }

      return db
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.status, "connected"));
    },

    async updateCampaignLead(id: string, patch: Record<string, unknown>) {
      await db
        .update(campaignLeads)
        .set(patch)
        .where(eq(campaignLeads.id, id));
    },

    /** True when the lead already has an unprocessed job queued. */
    async hasPendingJob(campaignLeadId: string): Promise<boolean> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sendJobs)
        .where(
          and(
            eq(sendJobs.campaignLeadId, campaignLeadId),
            sql`send_jobs.state IN ('pending', 'claimed')`,
          ),
        );
      return (rows[0]?.count ?? 0) > 0;
    },

    async insertSendJobs(
      jobs: Array<{
        campaignLeadId: string;
        stepId: string;
        variantId: string | null;
        mailboxId: string;
        scheduledAt: Date;
      }>,
    ) {
      if (jobs.length === 0) return;
      await db.insert(sendJobs).values(
        jobs.map((j) => ({
          campaignLeadId: j.campaignLeadId,
          stepId: j.stepId,
          variantId: j.variantId,
          mailboxId: j.mailboxId,
          scheduledAt: j.scheduledAt,
          state: "pending",
        })),
      );
    },

    async countSendsToday(campaignId: string) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sendJobs)
        .innerJoin(campaignLeads, eq(sendJobs.campaignLeadId, campaignLeads.id))
        .where(
          and(
            eq(campaignLeads.campaignId, campaignId),
            sql`send_jobs.scheduled_at::date = now()::date`,
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async countNewLeadsToday(campaignId: string) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sendJobs)
        .innerJoin(campaignLeads, eq(sendJobs.campaignLeadId, campaignLeads.id))
        .where(
          and(
            eq(campaignLeads.campaignId, campaignId),
            sql`send_jobs.scheduled_at::date = now()::date`,
            sql`campaign_leads.current_step_id = (SELECT id FROM campaign_steps WHERE campaign_id = ${campaignId} ORDER BY position LIMIT 1)`,
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async isBlocklisted(email: string) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(blocklist)
        .where(eq(blocklist.value, email));
      return (rows[0]?.count ?? 0) > 0;
    },

    /** The workspace timezone, used to evaluate send windows. */
    async workspaceTimezone(): Promise<string> {
      const rows = await db
        .select({ timezone: workspaces.timezone })
        .from(workspaces)
        .limit(1);
      return rows[0]?.timezone ?? "UTC";
    },

    /**
     * Everything the stop-condition rules need to know about a lead.
     *
     * One query, deliberately: the scheduler calls this for every enrolled
     * lead on every tick, so it has to be cheap. The reply flags come from
     * the inbox, the company flag from the other leads in the same campaign.
     */
    async stopContext(
      leadId: string,
      campaignId: string,
    ): Promise<{
      hasReply: boolean;
      hasAutoReply: boolean;
      unsubscribed: boolean;
      bounced: boolean;
      companyAlreadyContacted: boolean;
      oooUntil: Date | null;
    }> {
      const [leadRows, replyRows, companyRows] = await Promise.all([
        db
          .select({
            unsubscribed: leads.unsubscribed,
            oooUntil: leads.oooUntil,
            emailStatus: leads.emailStatus,
            company: leads.company,
          })
          .from(leads)
          .where(eq(leads.id, leadId))
          .limit(1),
        db
          .select({
            auto: sql<boolean>`bool_or(${messages.isAutoReply} = 1)`,
            count: sql<number>`count(*)::int`,
          })
          .from(messages)
          .where(
            and(
              eq(messages.leadId, leadId),
              eq(messages.direction, "inbound"),
            ),
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaignLeads)
          .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
          .where(
            and(
              eq(campaignLeads.campaignId, campaignId),
              sql`${campaignLeads.leadId} <> ${leadId}`,
              sql`${leads.company} IS NOT NULL AND ${leads.company} <> ''`,
              sql`${leads.company} = (SELECT company FROM leads WHERE id = ${leadId})`,
              sql`${campaignLeads.lastSentAt} IS NOT NULL`,
            ),
          ),
      ]);

      const lead = leadRows[0];
      const replies = replyRows[0];

      return {
        hasReply: (replies?.count ?? 0) > 0 && !(replies?.auto ?? true),
        hasAutoReply: (replies?.count ?? 0) > 0 && (replies?.auto ?? false),
        unsubscribed: (lead?.unsubscribed ?? 0) === 1,
        bounced: lead?.emailStatus === "invalid",
        companyAlreadyContacted: (companyRows[0]?.count ?? 0) > 0,
        oooUntil: lead?.oooUntil ?? null,
      };
    },

    /** Stop a lead's participation in a campaign. */
    async stopCampaignLead(id: string, reason: string) {
      await db
        .update(campaignLeads)
        .set({ state: "stopped", stoppedReason: reason, nextStepAt: null })
        .where(eq(campaignLeads.id, id));
    },
  };
}

export type SchedulerRepository = ReturnType<typeof createSchedulerRepository>;