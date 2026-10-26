import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  campaignLeads,
  campaignSubsequenceSteps,
  campaignSubsequences,
  subsequenceEnrollments,
  type Database,
} from "@mailrung/db";

export function createSubsequenceRepository({ db }: { db: Database }) {
  return {
    async list(workspaceId: string, campaignId?: string) {
      const conditions = [eq(campaignSubsequences.workspaceId, workspaceId)];
      if (campaignId) {
        conditions.push(eq(campaignSubsequences.campaignId, campaignId));
      }
      return db
        .select()
        .from(campaignSubsequences)
        .where(and(...conditions))
        .orderBy(desc(campaignSubsequences.createdAt));
    },

    async byId(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(campaignSubsequences)
        .where(
          and(
            eq(campaignSubsequences.workspaceId, workspaceId),
            eq(campaignSubsequences.id, id),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async steps(subsequenceId: string) {
      return db
        .select()
        .from(campaignSubsequenceSteps)
        .where(eq(campaignSubsequenceSteps.subsequenceId, subsequenceId))
        .orderBy(asc(campaignSubsequenceSteps.position));
    },

    async create(entry: {
      workspaceId: string;
      campaignId: string;
      name: string;
      trigger: "reply" | "reply_keyword" | "status_change" | "bounce" | "manual";
      triggerKeyword: string | null;
      active: boolean;
    }) {
      const rows = await db
        .insert(campaignSubsequences)
        .values({
          workspaceId: entry.workspaceId,
          campaignId: entry.campaignId,
          name: entry.name,
          trigger: entry.trigger,
          triggerKeyword: entry.triggerKeyword,
          active: entry.active ? 1 : 0,
        })
        .returning();
      return rows[0]!;
    },

    async update(id: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(campaignSubsequences)
        .set(patch)
        .where(eq(campaignSubsequences.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async remove(id: string) {
      await db.delete(campaignSubsequences).where(eq(campaignSubsequences.id, id));
    },

    async createStep(entry: {
      subsequenceId: string;
      position: number;
      subject: string | null;
      bodyHtml: string;
      delayMinutes: number;
    }) {
      const rows = await db
        .insert(campaignSubsequenceSteps)
        .values(entry)
        .returning();
      return rows[0]!;
    },

    async nextPosition(subsequenceId: string) {
      const rows = await db
        .select({ max: sql<number>`coalesce(max(${campaignSubsequenceSteps.position}), 0)::int` })
        .from(campaignSubsequenceSteps)
        .where(eq(campaignSubsequenceSteps.subsequenceId, subsequenceId));
      return (rows[0]?.max ?? 0) + 1;
    },

    async stepById(subsequenceId: string, stepId: string) {
      const rows = await db
        .select()
        .from(campaignSubsequenceSteps)
        .where(
          and(
            eq(campaignSubsequenceSteps.subsequenceId, subsequenceId),
            eq(campaignSubsequenceSteps.id, stepId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async updateStep(id: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(campaignSubsequenceSteps)
        .set(patch)
        .where(eq(campaignSubsequenceSteps.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async removeStep(id: string) {
      await db
        .delete(campaignSubsequenceSteps)
        .where(eq(campaignSubsequenceSteps.id, id));
    },

    /* ---------------------------- enrollment ---------------------------- */

    async campaignLeadFor(leadId: string, campaignId: string) {
      const rows = await db
        .select()
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.leadId, leadId),
            eq(campaignLeads.campaignId, campaignId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async enroll(entry: {
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

    async enrollments(subsequenceId: string) {
      return db
        .select()
        .from(subsequenceEnrollments)
        .where(eq(subsequenceEnrollments.subsequenceId, subsequenceId))
        .orderBy(desc(subsequenceEnrollments.createdAt));
    },
  };
}

export type SubsequenceRepository = ReturnType<typeof createSubsequenceRepository>;
