import { and, eq, lte, sql } from "drizzle-orm";
import {
  campaignLeads,
  campaignSubsequenceSteps,
  campaignSubsequences,
  mailboxes,
  sendJobs,
  subsequenceEnrollments,
  type Database,
} from "@mailrung/db";

export function createSubsequenceRepository({ db }: { db: Database }) {
  return {
    /** Subsequences of a campaign that are armed for this trigger. */
    async matching(input: {
      campaignId: string;
      trigger: "reply" | "reply_keyword" | "status_change" | "bounce" | "manual";
      keyword?: string | null;
    }) {
      const rows = await db
        .select()
        .from(campaignSubsequences)
        .where(
          and(
            eq(campaignSubsequences.campaignId, input.campaignId),
            eq(campaignSubsequences.trigger, input.trigger),
            eq(campaignSubsequences.active, 1),
          ),
        );
      return rows;
    },

    async stepsFor(subsequenceId: string) {
      return db
        .select()
        .from(campaignSubsequenceSteps)
        .where(eq(campaignSubsequenceSteps.subsequenceId, subsequenceId))
        .orderBy(campaignSubsequenceSteps.position);
    },

    async enrollment(subsequenceId: string, campaignLeadId: string) {
      const rows = await db
        .select()
        .from(subsequenceEnrollments)
        .where(
          and(
            eq(subsequenceEnrollments.subsequenceId, subsequenceId),
            eq(subsequenceEnrollments.campaignLeadId, campaignLeadId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async createEnrollment(entry: {
      workspaceId: string;
      subsequenceId: string;
      campaignLeadId: string;
      leadId: string;
      currentStepPosition: number;
      nextStepAt: Date;
    }) {
      const rows = await db
        .insert(subsequenceEnrollments)
        .values(entry)
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? null;
    },

    async advanceEnrollment(id: string, patch: { currentStepPosition: number; nextStepAt: Date | null; completed: number; completedAt?: Date | null }) {
      const rows = await db
        .update(subsequenceEnrollments)
        .set(patch)
        .where(eq(subsequenceEnrollments.id, id))
        .returning();
      return rows[0] ?? null;
    },

    /** Enrollments whose next step is due. */
    async dueEnrollments(now: Date) {
      return db
        .select()
        .from(subsequenceEnrollments)
        .where(
          and(
            eq(subsequenceEnrollments.completed, 0),
            lte(subsequenceEnrollments.nextStepAt, now),
          ),
        );
    },

    async campaignLeadById(id: string) {
      const rows = await db
        .select()
        .from(campaignLeads)
        .where(eq(campaignLeads.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /** The mailboxes a campaign may send from. */
    async mailboxesForCampaign(campaignId: string) {
      const rows = await db
        .select({ id: mailboxes.id, email: mailboxes.email })
        .from(mailboxes)
        .where(sql`mailboxes.status = 'connected'`)
        .limit(20);
      void campaignId;
      return rows;
    },

    /** Does this lead already have an unprocessed job? */
    async hasPendingJob(campaignLeadId: string) {
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

    async insertSendJob(entry: {
      campaignLeadId: string;
      stepId: string;
      subsequenceStepId: string | null;
      mailboxId: string;
      scheduledAt: Date;
    }) {
      const rows = await db
        .insert(sendJobs)
        .values({
          campaignLeadId: entry.campaignLeadId,
          stepId: entry.stepId,
          subsequenceStepId: entry.subsequenceStepId,
          mailboxId: entry.mailboxId,
          scheduledAt: entry.scheduledAt,
          state: "pending",
        })
        .returning();
      return rows[0] ?? null;
    },

    /** Put the lead back into the campaign's main sequence. */
    async resumeCampaignLead(campaignLeadId: string) {
      await db
        .update(campaignLeads)
        .set({ state: "active", stoppedReason: null, nextStepAt: new Date() })
        .where(eq(campaignLeads.id, campaignLeadId));
    },

    /** Pause the main sequence while the lead is in a subsequence. */
    async pauseCampaignLead(campaignLeadId: string) {
      await db
        .update(campaignLeads)
        .set({ state: "paused", stoppedReason: "subsequence", nextStepAt: null })
        .where(eq(campaignLeads.id, campaignLeadId));
    },
  };
}

export type SubsequenceRepository = ReturnType<
  typeof createSubsequenceRepository
>;
