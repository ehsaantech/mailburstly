import type { Logger } from "@/core/logger";
import {
  createSubsequenceRepository,
  type SubsequenceRepository,
} from "./repository";

export interface SubsequenceServiceDeps {
  db: { db: Parameters<typeof createSubsequenceRepository>[0]["db"] };
  log: Logger;
}

export function createSubsequenceService(deps: SubsequenceServiceDeps) {
  const repo: SubsequenceRepository = createSubsequenceRepository({
    db: deps.db.db,
  });
  const { log } = deps;

  return {
    /**
     * Enroll a lead in a subsequence when its trigger fires.
     *
     * A lead only enters a sequence once: the second trigger for the same
     * sequence is ignored, because a lead who replies twice should not
     * receive the follow-up twice.
     */
    async enroll(input: {
      workspaceId: string;
      campaignId: string;
      campaignLeadId: string;
      leadId: string;
      trigger: "reply" | "reply_keyword" | "status_change" | "bounce" | "manual";
      keyword?: string | null;
    }): Promise<boolean> {
      const candidates = await repo.matching({
        campaignId: input.campaignId,
        trigger: input.trigger,
      });

      for (const sequence of candidates) {
        // A keyword sequence only fires for its own word.
        if (input.trigger === "reply_keyword") {
          const wanted = (sequence.triggerKeyword ?? "").toLowerCase();
          if (!wanted || wanted !== (input.keyword ?? "").toLowerCase()) continue;
        }

        const existing = await repo.enrollment(sequence.id, input.campaignLeadId);
        if (existing) continue;

        const steps = await repo.stepsFor(sequence.id);
        if (steps.length === 0) continue;

        const first = steps[0]!;
        const delayMinutes = first.delayMinutes ?? 0;

        const enrollment = await repo.createEnrollment({
          workspaceId: input.workspaceId,
          subsequenceId: sequence.id,
          campaignLeadId: input.campaignLeadId,
          leadId: input.leadId,
          currentStepPosition: first.position,
          nextStepAt: new Date(Date.now() + delayMinutes * 60_000),
        });

        if (!enrollment) continue;

        await repo.pauseCampaignLead(input.campaignLeadId);
        log.info("lead entered a subsequence", {
          leadId: input.leadId,
          subsequenceId: sequence.id,
          name: sequence.name,
        });
        return true;
      }

      return false;
    },

    /**
     * Send the next step of every due subsequence.
     *
     * The main sequence is paused for these leads, so this is the only
     * thing that should be reaching them.
     */
    async run(): Promise<void> {
      const now = new Date();
      const due = await repo.dueEnrollments(now);
      if (due.length === 0) return;

      for (const enrollment of due) {
        const campaignLead = await repo.campaignLeadById(enrollment.campaignLeadId);
        if (!campaignLead) continue;

        if (await repo.hasPendingJob(enrollment.campaignLeadId)) continue;

        const steps = await repo.stepsFor(enrollment.subsequenceId);
        const step = steps.find((s) => s.position === enrollment.currentStepPosition);
        if (!step) {
          await repo.advanceEnrollment(enrollment.id, {
            currentStepPosition: enrollment.currentStepPosition,
            nextStepAt: null,
            completed: 1,
            completedAt: new Date(),
          });
          await repo.resumeCampaignLead(enrollment.campaignLeadId);
          continue;
        }

        const mailboxes = await repo.mailboxesForCampaign(campaignLead.campaignId);
        const mailbox = mailboxes[0];
        if (!mailbox) continue;

        await repo.insertSendJob({
          campaignLeadId: enrollment.campaignLeadId,
          // The main step is still the join point; the subsequence step
          // carries the content.
          stepId: campaignLead.currentStepId ?? step.id,
          subsequenceStepId: step.id,
          mailboxId: mailbox.id,
          scheduledAt: new Date(),
        });

        // Advance to the next step, or finish the sequence.
        const next = steps.find((s) => s.position > step.position);
        if (next) {
          await repo.advanceEnrollment(enrollment.id, {
            currentStepPosition: next.position,
            nextStepAt: new Date(Date.now() + (next.delayMinutes ?? 0) * 60_000),
            completed: 0,
          });
        } else {
          await repo.advanceEnrollment(enrollment.id, {
            currentStepPosition: step.position,
            nextStepAt: null,
            completed: 1,
            completedAt: new Date(),
          });
          await repo.resumeCampaignLead(enrollment.campaignLeadId);
          log.info("subsequence finished — lead back in the main sequence", {
            leadId: enrollment.leadId,
          });
        }
      }
    },
  };
}

export type SubsequenceService = ReturnType<typeof createSubsequenceService>;
