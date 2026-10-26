import { conflict, notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import { createSubsequenceRepository } from "./repository";
import type {
  CreateSubsequenceInput,
  CreateSubsequenceStepInput,
  EnrollLeadInput,
  ListSubsequencesQuery,
  UpdateSubsequenceInput,
  UpdateSubsequenceStepInput,
} from "./validator";

export interface SubsequenceServiceDeps {
  db: DbHandle;
  workspaceId: string | (() => Promise<string>);
}

export function createSubsequenceService(deps: SubsequenceServiceDeps) {
  const repository = createSubsequenceRepository({ db: deps.db.db });

  const ws = async () =>
    typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId;

  const requireSequence = async (id: string) => {
    const row = await repository.byId(await ws(), id);
    if (!row) throw notFound("Subsequence");
    return row;
  };

  return {
    async list(query: ListSubsequencesQuery) {
      const rows = await repository.list(await ws(), query.campaignId);
      // Each sequence carries its steps, so the client can render it without
      // a second request per row.
      return Promise.all(
        rows.map(async (row) => ({
          ...row,
          steps: await repository.steps(row.id),
        })),
      );
    },

    async get(id: string) {
      const row = await requireSequence(id);
      return { ...row, steps: await repository.steps(id) };
    },

    async create(input: CreateSubsequenceInput) {
      const sequence = await repository.create({
        workspaceId: await ws(),
        campaignId: input.campaignId,
        name: input.name,
        trigger: input.trigger,
        triggerKeyword: input.triggerKeyword ?? null,
        active: input.active,
      });

      let position = 1;
      for (const step of input.steps) {
        await repository.createStep({
          subsequenceId: sequence.id,
          position,
          subject: step.subject ?? null,
          bodyHtml: step.bodyHtml,
          delayMinutes: step.delayMinutes,
        });
        position++;
      }

      return { ...sequence, steps: await repository.steps(sequence.id) };
    },

    async update(id: string, input: UpdateSubsequenceInput) {
      await requireSequence(id);

      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.trigger !== undefined) patch.trigger = input.trigger;
      if (input.triggerKeyword !== undefined) {
        patch.triggerKeyword = input.triggerKeyword;
      }
      if (input.active !== undefined) patch.active = input.active ? 1 : 0;

      const row = await repository.update(id, patch);
      return { ...row!, steps: await repository.steps(id) };
    },

    async remove(id: string) {
      await requireSequence(id);
      await repository.remove(id);
    },

    /* ------------------------------ steps ------------------------------- */

    async addStep(id: string, input: CreateSubsequenceStepInput) {
      await requireSequence(id);

      const position =
        input.position ?? (await repository.nextPosition(id));

      const step = await repository.createStep({
        subsequenceId: id,
        position,
        subject: input.subject ?? null,
        bodyHtml: input.bodyHtml,
        delayMinutes: input.delayMinutes,
      });

      return step;
    },

    async updateStep(
      id: string,
      stepId: string,
      input: UpdateSubsequenceStepInput,
    ) {
      await requireSequence(id);
      const existing = await repository.stepById(id, stepId);
      if (!existing) throw notFound("Subsequence step");

      const patch: Record<string, unknown> = {};
      if (input.subject !== undefined) patch.subject = input.subject;
      if (input.bodyHtml !== undefined) patch.bodyHtml = input.bodyHtml;
      if (input.delayMinutes !== undefined) patch.delayMinutes = input.delayMinutes;
      if (input.position !== undefined) patch.position = input.position;

      return repository.updateStep(stepId, patch);
    },

    async removeStep(id: string, stepId: string) {
      await requireSequence(id);
      const existing = await repository.stepById(id, stepId);
      if (!existing) throw notFound("Subsequence step");
      await repository.removeStep(stepId);
    },

    /* ---------------------------- enrolment ----------------------------- */

    /**
     * Put a lead into a sequence by hand.
     *
     * The main sequence pauses for the lead while they are in it, and
     * resumes when the sequence ends.
     */
    async enroll(id: string, input: EnrollLeadInput) {
      const sequence = await requireSequence(id);
      const campaignLead = await repository.campaignLeadFor(
        input.leadId,
        sequence.campaignId,
      );
      if (!campaignLead) throw notFound("Lead enrollment in this campaign");

      const existing = await repository.enrollment(id, campaignLead.id);
      if (existing) throw conflict("That lead is already in this sequence");

      const steps = await repository.steps(id);
      const first = steps[0];
      if (!first) throw conflict("This sequence has no steps yet");

      const enrollment = await repository.enroll({
        workspaceId: await ws(),
        subsequenceId: id,
        campaignLeadId: campaignLead.id,
        leadId: input.leadId,
        currentStepPosition: first.position,
        nextStepAt: new Date(Date.now() + (first.delayMinutes ?? 0) * 60_000),
      });

      return enrollment;
    },

    async enrollments(id: string) {
      await requireSequence(id);
      return repository.enrollments(id);
    },
  };
}

export type SubsequenceService = ReturnType<typeof createSubsequenceService>;
