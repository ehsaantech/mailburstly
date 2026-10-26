import type { DbHandle } from "@/db";
import type { Logger } from "@/core/logger";
import { createSchedulerRepository } from "./repository";
import {
  evaluateStopConditions,
  isLeadAvailable,
  isWithinSendWindow,
  nextWindowOpen,
  parseSchedule,
  remainingNewLeadAllowance,
  type CampaignRules,
} from "@mailrung/shared";

export interface SchedulerServiceDeps {
  db: DbHandle;
  /** Resolves the workspace id for scoping. */
  workspaceId: () => Promise<string>;
  log?: Logger;
}

/**
 * Scheduler service — the brain of the outbound loop.
 *
 * Every 30s (configurable), it:
 *   1. Finds all active campaigns
 *   2. For each, finds enrolled leads in 'active' state
 *   3. For newly enrolled leads (no current step), sets current step to step 1
 *   4. For due leads (next_step_at <= now), checks schedule window, daily
 *      limits, stop conditions, blocklist
 *   5. Inserts send_jobs for eligible leads
 *   6. Updates next_step_at for each lead
 *
 * This is M3's core deliverable — the thing that makes "first real email sent"
 * possible. The dispatcher (Go) picks up send_jobs and sends them.
 */
export function createSchedulerService(deps: SchedulerServiceDeps) {
  const repo = createSchedulerRepository({ db: deps.db.db });
  // A scheduler that cannot explain itself is a scheduler nobody trusts, so
  // it always has a logger — a no-op one when none was supplied.
  const log: Logger =
    deps.log ??
    {
      child: () => log,
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

  return {
    async tick() {
      const campaigns = await repo.activeCampaigns();
      const timezone = await repo.workspaceTimezone();
      const now = new Date();

      for (const campaign of campaigns) {
        /* ---------------------- send window (schedule) ---------------------- */

        // A campaign outside its send window does not send at all. This is
        // checked before any per-lead work, so a closed window costs one
        // evaluation rather than one query per lead.
        const schedule = parseSchedule(campaign.schedule);

        if (!isWithinSendWindow(schedule, now, timezone)) {
          const opens = nextWindowOpen(schedule, now, timezone);
          log.info("campaign outside its send window", {
            campaignId: campaign.id,
            nextOpenAt: opens?.toISOString() ?? null,
          });
          continue;
        }

        const rules: CampaignRules = {
          schedule,
          stopOnReply: campaign.stopOnReply,
          stopOnAutoReply: campaign.stopOnAutoReply,
          stopForCompany: campaign.stopForCompany,
          dailyMaxLeads: campaign.dailyMaxLeads,
        };

        const leads = await repo.enrolledLeads(campaign.id);
        const steps = await repo.stepsForCampaign(campaign.id);

        if (steps.length === 0) continue;

        const firstStep = steps[0]!;
        const mailboxes = await repo.mailboxesForCampaign(campaign.id);

        if (mailboxes.length === 0) continue;

        // Daily limits
        const dailyLimit = campaign.dailyLimit ?? mailboxes.length * 30;
        const dailyMaxLeads = campaign.dailyMaxLeads ?? null;
        const sentToday = await repo.countSendsToday(campaign.id);
        const newLeadsToday = await repo.countNewLeadsToday(campaign.id);

        const remainingDaily = dailyLimit - sentToday;
        const remainingNewLeads = remainingNewLeadAllowance(
          dailyMaxLeads,
          newLeadsToday,
        );

        if (remainingDaily <= 0) continue;

        const jobsToCreate: Array<{
          campaignLeadId: string;
          stepId: string;
          variantId: string | null;
          mailboxId: string;
          scheduledAt: Date;
        }> = [];

        let mailboxIndex = 0;

        for (const cl of leads) {
          // Newly enrolled: set current step to step 1, schedule now.
          if (!cl.currentStepId) {
            await repo.updateCampaignLead(cl.id, {
              currentStepId: firstStep.id,
              nextStepAt: new Date(),
            });
            cl.currentStepId = firstStep.id;
            cl.nextStepAt = new Date();
          }

          // Skip if not due yet.
          if (!cl.nextStepAt || cl.nextStepAt > now) continue;

          // Stop conditions.
          if (cl.state !== "active") continue;

          // Already queued? The dispatcher advances next_step_at after a
          // confirmed send, so without this check we would re-queue every
          // lead on every tick.
          if (await repo.hasPendingJob(cl.id)) continue;

          const lead = await repo.leadById(cl.leadId);
          if (!lead) continue;

          /* --------------------- stop conditions (rules) -------------------- */

          const context = await repo.stopContext(cl.leadId, campaign.id);
          const stop = evaluateStopConditions(rules, context);
          if (stop.stop) {
            await repo.stopCampaignLead(cl.id, stop.reason!);
            log.info("lead stopped by campaign rules", {
              campaignId: campaign.id,
              campaignLeadId: cl.id,
              reason: stop.reason,
            });
            continue;
          }

          // Out of office is a pause, not a stop: the lead stays enrolled
          // and the sequence picks up when they are back.
          const availability = isLeadAvailable(context, now);
          if (!availability.available) {
            await repo.updateCampaignLead(cl.id, {
              nextStepAt: context.oooUntil,
            });
            continue;
          }

          if (lead.emailStatus === "invalid") continue;
          if (lead.unsubscribed) continue;
          const blocked = await repo.isBlocklisted(lead.email);
          if (blocked) continue;

          // Max new leads check (only for step 1).
          const isFirstStep = cl.currentStepId === firstStep.id;
          if (
            isFirstStep &&
            newLeadsToday + jobsToCreate.length >= remainingNewLeads
          ) {
            break;
          }

          // Variant assignment (sticky per lead).
          let variantId: string | null = null;
          const step = steps.find((s) => s.id === cl.currentStepId);
          if (!step) continue;
          const variants = await repo.variantsForStep(step.id);
          if (variants.length > 0) {
            const assignment = (cl.variantAssignments as Record<string, string>) ?? {};
            if (assignment[step.id]) {
              variantId = assignment[step.id]!;
            } else {
              // Weighted random selection.
              const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
              let roll = Math.random() * totalWeight;
              for (const v of variants) {
                roll -= v.weight;
                if (roll <= 0) {
                  variantId = v.id;
                  break;
                }
              }
              if (!variantId) variantId = variants[0]!.id;
              // Persist the assignment.
              await repo.updateCampaignLead(cl.id, {
                variantAssignments: { ...assignment, [step.id]: variantId },
              });
            }
          }

          // Pick mailbox (round-robin).
          const mailbox = mailboxes[mailboxIndex % mailboxes.length]!;
          mailboxIndex++;

          jobsToCreate.push({
            campaignLeadId: cl.id,
            stepId: step.id,
            variantId,
            mailboxId: mailbox.id,
            scheduledAt: new Date(),
          });

          // Stop if we've hit the daily limit.
          if (jobsToCreate.length >= remainingDaily) break;
        }

        await repo.insertSendJobs(jobsToCreate);

        // next_step_at is deliberately NOT advanced here. The dispatcher owns
        // it: it advances the lead to the next step once the send confirms.
        // Advancing it now would silently skip a lead whose send never
        // happened. Duplicates are prevented by the hasPendingJob check.
      }
    },
  };
}

export type SchedulerService = ReturnType<typeof createSchedulerService>;