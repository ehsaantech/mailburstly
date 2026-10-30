import { badRequest, notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import { renderTemplate } from "@/lib/renderer";
import { submitMessage } from "@/lib/mailcore";
import { raiseAlert } from "@/lib/alerts";
import { createCampaignRepository, type CampaignRow } from "./repository";
import { createListRepository } from "../lists/repository";
import type {
  CreateCampaignInput,
  CreateStepInput,
  CreateVariantInput,
  EnrollLeadsInput,
  PreviewStepInput,
  ReorderStepsInput,
  TestSendInput,
  UpdateCampaignInput,
  UpdateStepInput,
  UpdateVariantInput,
} from "./validator";

export interface CampaignServiceDeps {
  db: DbHandle;
  workspaceId: string | (() => Promise<string>);
  userId: string | (() => Promise<string>);
}

/**
 * Enrich a raw campaign row with computed fields the frontend expects.
 *
 * The DB stores configuration; the frontend needs aggregates (lead count,
 * step count, send counts). Those come from related tables.
 */
export function toSummary(
  row: CampaignRow,
  leadCount: number,
  stepCount: number,
  numbers: {
    sent: number;
    contacted: number;
    opened: number;
    clicked: number;
    replied: number;
    positiveReplies: number;
    opportunities: number;
    opportunityValue: number;
    bounced: number;
    progress: number;
  } = {
    sent: 0,
    contacted: 0,
    opened: 0,
    clicked: 0,
    replied: 0,
    positiveReplies: 0,
    opportunities: 0,
    opportunityValue: 0,
    bounced: 0,
    progress: 0,
  },
) {
  return {
    id: row.id,
    name: row.name,
    status: row.status as "draft" | "active" | "paused" | "completed",
    createdAt: row.createdAt.toISOString(),
    launchedAt: row.launchedAt?.toISOString() ?? null,
    dailyLimit: row.dailyLimit,
    dailyMaxLeads: row.dailyMaxLeads,
    leadCount,
    contacted: numbers.contacted,
    progress: numbers.progress,
    sent: numbers.sent,
    opened: numbers.opened,
    replied: numbers.replied,
    positiveReplies: numbers.positiveReplies,
    opportunities: numbers.opportunities,
    opportunityValue: numbers.opportunityValue,
    bounced: numbers.bounced,
    mailboxIds: [],
    stepCount,
    pausedReason: row.pausedReason,
    tags: row.tags ?? [],
    emailGapMinutes: row.emailGapMinutes,
    randomWaitMax: row.randomWaitMax,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** "YYYY-MM-DD" for `days` days before today. */
function since(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createCampaignService(deps: CampaignServiceDeps) {
  const repository = createCampaignRepository({ db: deps.db.db });
  const listRepository = createListRepository({ db: deps.db.db });

  const ws = async () =>
    typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId;

  const requireCampaign = async (id: string) => {
    const row = await repository.byId(await ws(), id);
    if (!row) throw notFound("Campaign");
    return row;
  };

  /** The merge variables a lead contributes to a template. */
  async function variablesFor(input: {
    leadId?: string | null;
    data?: Record<string, string> | null;
  }): Promise<Record<string, string>> {
    const variables: Record<string, string> = { ...(input.data ?? {}) };

    if (!input.leadId) return variables;

    const lead = await repository.leadById(await ws(), input.leadId);
    if (!lead) return variables;

    return {
      ...variables,
      first_name: lead.firstName ?? "",
      last_name: lead.lastName ?? "",
      email: lead.email,
      company: lead.company ?? "",
      title: lead.title ?? "",
      ...Object.fromEntries(
        Object.entries(lead.customVariables ?? {}).map(([key, value]) => [
          key,
          String(value ?? ""),
        ]),
      ),
    };
  }

  /** A summary of a campaign, with its numbers. */
  async function summaryFor(row: CampaignRow) {
    const ids = [row.id];
    const [counts, funnels, progress] = await Promise.all([
      repository.countsForCampaigns(ids),
      repository.funnelsForCampaigns(ids, since(30), today()),
      repository.progressForCampaigns(ids),
    ]);
    const c = counts.get(row.id);
    const f = funnels.get(row.id);
    return toSummary(row, c?.leadCount ?? 0, c?.stepCount ?? 0, {
      sent: f?.sent ?? 0,
      contacted: f?.contacted ?? 0,
      opened: f?.opened ?? 0,
      clicked: f?.clicked ?? 0,
      replied: f?.replied ?? 0,
      positiveReplies: f?.positiveReplies ?? 0,
      opportunities: f?.opportunities ?? 0,
      opportunityValue: f?.opportunityValue ?? 0,
      bounced: f?.bounced ?? 0,
      progress: progress.get(row.id) ?? 0,
    });
  }

  return {
    async list() {
      const rows = await repository.list(await ws());
      const ids = rows.map((r) => r.id);

      const [counts, funnels, progress] = await Promise.all([
        repository.countsForCampaigns(ids),
        repository.funnelsForCampaigns(ids, since(30), today()),
        repository.progressForCampaigns(ids),
      ]);

      return rows.map((row) => {
        const c = counts.get(row.id);
        const f = funnels.get(row.id);
        return toSummary(row, c?.leadCount ?? 0, c?.stepCount ?? 0, {
          sent: f?.sent ?? 0,
          contacted: f?.contacted ?? 0,
          opened: f?.opened ?? 0,
          clicked: f?.clicked ?? 0,
          replied: f?.replied ?? 0,
          positiveReplies: f?.positiveReplies ?? 0,
          opportunities: f?.opportunities ?? 0,
          opportunityValue: f?.opportunityValue ?? 0,
          bounced: f?.bounced ?? 0,
          progress: progress.get(row.id) ?? 0,
        });
      });
    },

    /** The campaign, with its enrolled leads. */
    async get(id: string) {
      const row = await requireCampaign(id);
      const [leads, lists] = await Promise.all([
        repository.listCampaignLeads(id, 200, 0),
        listRepository.listsForCampaign(id),
      ]);
      return {
        ...(await summaryFor(row)),
        leads,
        lists: lists.map((list) => ({
          id: list.id,
          name: list.name,
          description: list.description ?? null,
          memberCount: list.memberCount ?? 0,
        })),
      };
    },

    async listSteps(campaignId: string) {
      await requireCampaign(campaignId);
      return repository.listSteps(campaignId);
    },

    /** The steps, each with its A/Z variants. */
    async listStepsWithVariants(campaignId: string) {
      await requireCampaign(campaignId);
      const steps = await repository.listSteps(campaignId);

      return Promise.all(
        steps.map(async (step) => ({
          ...step,
          variants: await repository.listVariants(step.id),
        })),
      );
    },

    async listMailboxIds(campaignId: string): Promise<string[]> {
      await requireCampaign(campaignId);
      return repository.listAssignedMailboxIds(campaignId);
    },

    async listCampaignLeads(campaignId: string, limit?: number, offset?: number) {
      await requireCampaign(campaignId);
      return repository.listCampaignLeads(campaignId, limit, offset);
    },

    async countCampaignLeads(campaignId: string) {
      await requireCampaign(campaignId);
      return repository.countCampaignLeads(campaignId);
    },

    async create(input: CreateCampaignInput) {
      const row = await repository.create({
        workspaceId: await ws(),
        name: input.name,
        dailyLimit: input.dailyLimit ?? null,
        dailyMaxLeads: input.dailyMaxLeads ?? null,
        emailGapMinutes: input.emailGapMinutes,
        randomWaitMax: input.randomWaitMax,
        stopOnReply: input.stopOnReply,
        stopOnAutoReply: input.stopOnAutoReply,
        stopForCompany: input.stopForCompany,
        openTracking: input.openTracking,
        linkTracking: input.linkTracking,
        textOnly: input.textOnly,
        insertUnsubscribeHeader: input.insertUnsubscribeHeader,
        allowRiskyContacts: input.allowRiskyContacts,
        schedule: input.schedule,
      });
      return toSummary(row, 0, 0);
    },

    async update(id: string, patch: UpdateCampaignInput) {
      const workspaceId = await ws();
      await requireCampaign(id);

      const dbPatch: Record<string, unknown> = {};
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.tags !== undefined) dbPatch.tags = patch.tags;
      if (patch.dailyLimit !== undefined) dbPatch.dailyLimit = patch.dailyLimit;
      if (patch.dailyMaxLeads !== undefined) dbPatch.dailyMaxLeads = patch.dailyMaxLeads;
      if (patch.stopOnReply !== undefined) dbPatch.stopOnReply = patch.stopOnReply;
      if (patch.stopOnAutoReply !== undefined) dbPatch.stopOnAutoReply = patch.stopOnAutoReply;
      if (patch.stopForCompany !== undefined) dbPatch.stopForCompany = patch.stopForCompany;
      if (patch.openTracking !== undefined) dbPatch.openTracking = patch.openTracking;
      if (patch.linkTracking !== undefined) dbPatch.linkTracking = patch.linkTracking;
      if (patch.textOnly !== undefined) dbPatch.textOnly = patch.textOnly;
      if (patch.insertUnsubscribeHeader !== undefined) dbPatch.insertUnsubscribeHeader = patch.insertUnsubscribeHeader;
      if (patch.allowRiskyContacts !== undefined) dbPatch.allowRiskyContacts = patch.allowRiskyContacts;
      if (patch.schedule !== undefined) dbPatch.schedule = patch.schedule;

      const row = await repository.update(workspaceId, id, dbPatch);
      if (!row) throw notFound("Campaign");
      return toSummary(row, 0, 0);
    },

    async remove(id: string) {
      const workspaceId = await ws();
      await requireCampaign(id);
      await repository.remove(workspaceId, id);
    },

    async launch(id: string) {
      const workspaceId = await ws();
      await requireCampaign(id);
      const row = await repository.update(workspaceId, id, {
        status: "active",
        launchedAt: new Date(),
        pausedReason: null,
        pausedAt: null,
      });
      if (!row) throw notFound("Campaign");
      return toSummary(row, 0, 0);
    },

    async pause(id: string) {
      const workspaceId = await ws();
      await requireCampaign(id);
      const row = await repository.update(workspaceId, id, {
        status: "paused",
        pausedReason: "Paused by the operator",
        pausedAt: new Date(),
      });
      if (!row) throw notFound("Campaign");
      return toSummary(row, 0, 0);
    },

    async resume(id: string) {
      const workspaceId = await ws();
      await requireCampaign(id);
      const row = await repository.update(workspaceId, id, {
        status: "active",
        pausedReason: null,
        pausedAt: null,
      });
      if (!row) throw notFound("Campaign");
      return toSummary(row, 0, 0);
    },

    async archive(id: string) {
      const workspaceId = await ws();
      await requireCampaign(id);
      const ok = await repository.archive(workspaceId, id);
      if (!ok) throw notFound("Campaign");
      return toSummary(await repository.byId(workspaceId, id) as any, 0, 0);
    },

    async restore(id: string) {
      const workspaceId = await ws();
      await requireCampaign(id);
      const ok = await repository.restore(workspaceId, id);
      if (!ok) throw notFound("Campaign");
      return toSummary(await repository.byId(workspaceId, id) as any, 0, 0);
    },

    async duplicate(id: string) {
      const workspaceId = await ws();
      await requireCampaign(id);
      const original = await repository.byId(workspaceId, id);
      const copy = await repository.duplicate(workspaceId, id, `Copy of ${original?.name ?? ""}`.trim());
      if (!copy) throw notFound("Campaign");
      return toSummary(copy, 0, 0);
    },

    async bulk(action: string, ids: string[]) {
      const result: { action: string; succeeded: string[]; failed: Array<{ id: string; reason: string }> } = {
        action,
        succeeded: [],
        failed: [],
      };
      for (const id of ids) {
        try {
          switch (action) {
            case "pause":
              await this.pause(id);
              break;
            case "resume":
              await this.resume(id);
              break;
            case "archive":
              await this.archive(id);
              break;
            case "restore":
              await this.restore(id);
              break;
            case "delete":
              await this.archive(id);
              break;
            case "duplicate":
              await this.duplicate(id);
              break;
          }
          result.succeeded.push(id);
        } catch (error) {
          result.failed.push({ id, reason: error instanceof Error ? error.message : "failed" });
        }
      }
      return result;
    },

    /* ------------------------------- steps ------------------------------- */

    async addStep(campaignId: string, input: CreateStepInput) {
      await requireCampaign(campaignId);

      const steps = await repository.listSteps(campaignId);
      const position = input.position ?? steps.length + 1;

      const row = await repository.createStep({
        campaignId,
        subject: input.subject ?? null,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText ?? null,
        preheader: input.preheader ?? null,
        delayMinutes: input.delayMinutes,
        threadMode: input.threadMode,
        position,
      });

      return { ...row, variants: [] };
    },

    async updateStep(campaignId: string, stepId: string, patch: UpdateStepInput) {
      await requireCampaign(campaignId);
      const existing = await repository.getStep(campaignId, stepId);
      if (!existing) throw notFound("Step");

      const dbPatch: Record<string, unknown> = {};
      if (patch.subject !== undefined) dbPatch.subject = patch.subject;
      if (patch.bodyHtml !== undefined) dbPatch.bodyHtml = patch.bodyHtml;
      if (patch.bodyText !== undefined) dbPatch.bodyText = patch.bodyText;
      if (patch.preheader !== undefined) dbPatch.preheader = patch.preheader;
      if (patch.delayMinutes !== undefined) dbPatch.delayMinutes = patch.delayMinutes;
      if (patch.threadMode !== undefined) dbPatch.threadMode = patch.threadMode;
      if (patch.position !== undefined) dbPatch.position = patch.position;

      const row = await repository.updateStep(campaignId, stepId, dbPatch);
      if (!row) throw notFound("Step");
      return { ...row, variants: await repository.listVariants(stepId) };
    },

    async removeStep(campaignId: string, stepId: string) {
      await requireCampaign(campaignId);
      const existing = await repository.getStep(campaignId, stepId);
      if (!existing) throw notFound("Step");
      await repository.removeStep(campaignId, stepId);

      // Close the gap the deleted step left behind, so the positions stay
      // 1..n and the next step's delay still means "after the previous one".
      const steps = await repository.listSteps(campaignId);
      await repository.reorderSteps(
        campaignId,
        steps.map((s) => s.id),
      );
    },

    /** Reorders the steps. */
    async reorderSteps(campaignId: string, input: ReorderStepsInput) {
      await requireCampaign(campaignId);

      const steps = await repository.listSteps(campaignId);
      const known = new Set(steps.map((s) => s.id));

      // Every step must be named, and no stranger may be.
      if (
        input.stepIds.length !== steps.length ||
        input.stepIds.some((id) => !known.has(id))
      ) {
        throw badRequest(
          "The new order must name every step in the campaign exactly once",
        );
      }

      await repository.reorderSteps(campaignId, input.stepIds);
      return repository.listSteps(campaignId);
    },

    /* ------------------------------ variants ----------------------------- */

    async listVariants(campaignId: string, stepId: string) {
      await requireCampaign(campaignId);
      const step = await repository.getStep(campaignId, stepId);
      if (!step) throw notFound("Step");
      return repository.listVariants(stepId);
    },

    async createVariant(
      campaignId: string,
      stepId: string,
      input: CreateVariantInput,
    ) {
      await requireCampaign(campaignId);
      const step = await repository.getStep(campaignId, stepId);
      if (!step) throw notFound("Step");

      return repository.createVariant({
        stepId,
        label: input.label,
        subject: input.subject ?? null,
        bodyHtml: input.bodyHtml,
        weight: input.weight,
        pinned: input.pinned,
      });
    },

    async updateVariant(
      campaignId: string,
      stepId: string,
      variantId: string,
      patch: UpdateVariantInput,
    ) {
      await requireCampaign(campaignId);
      const step = await repository.getStep(campaignId, stepId);
      if (!step) throw notFound("Step");

      const dbPatch: Record<string, unknown> = {};
      if (patch.label !== undefined) dbPatch.label = patch.label;
      if (patch.subject !== undefined) dbPatch.subject = patch.subject;
      if (patch.bodyHtml !== undefined) dbPatch.bodyHtml = patch.bodyHtml;
      if (patch.weight !== undefined) dbPatch.weight = patch.weight;
      if (patch.pinned !== undefined) dbPatch.pinned = patch.pinned ? 1 : 0;

      const row = await repository.updateVariant(stepId, variantId, dbPatch);
      if (!row) throw notFound("Variant");
      return row;
    },

    async removeVariant(campaignId: string, stepId: string, variantId: string) {
      await requireCampaign(campaignId);
      const step = await repository.getStep(campaignId, stepId);
      if (!step) throw notFound("Step");

      const removed = await repository.removeVariant(stepId, variantId);
      if (!removed) throw notFound("Variant");
    },

    /* ------------------------ preview and test send ---------------------- */

    /**
     * Renders a step with real values, without sending anything.
     *
     * The rendering goes through the dispatcher, so the preview is exactly
     * what the recipient would see — including the fallback for a variable
     * the lead does not have.
     */
    async preview(campaignId: string, input: PreviewStepInput) {
      await requireCampaign(campaignId);

      const steps = await repository.listSteps(campaignId);
      if (steps.length === 0) throw notFound("Steps");

      const step = input.stepId
        ? steps.find((s) => s.id === input.stepId)
        : steps[0];
      if (!step) throw notFound("Step");

      const variables = await variablesFor(input);
      const [subject, body] = await Promise.all([
        renderTemplate({ template: step.subject ?? "", data: variables }),
        renderTemplate({ template: step.bodyHtml, data: variables }),
      ]);

      return {
        stepId: step.id,
        subject: subject.rendered,
        bodyHtml: body.rendered,
        /** False when the dispatcher could not be reached. */
        rendered: subject.ok && body.ok,
      };
    },

    /**
     * Sends one test of the sequence.
     *
     * The message goes out through the campaign's own mailbox, so the
     * operator sees exactly what a lead would see.
     */
    async testSend(campaignId: string, input: TestSendInput) {
      const campaign = await requireCampaign(campaignId);

      const steps = await repository.listSteps(campaignId);
      if (steps.length === 0) throw notFound("Steps");

      const step = input.stepId
        ? steps.find((s) => s.id === input.stepId)
        : steps[0];
      if (!step) throw notFound("Step");

      const assigned = await repository.listAssignedMailboxIds(campaignId);
      let mailbox = assigned.length > 0
        ? await repository.mailboxById(assigned[0]!)
        : null;
      if (!mailbox) {
        mailbox = await repository.anyConnectedMailbox();
      }
      if (!mailbox) {
        throw badRequest(
          "No connected mailbox to send the test from. Connect one first.",
        );
      }

      const variables = await variablesFor(input);
      const [subject, body] = await Promise.all([
        renderTemplate({
          template: step.subject ?? `Test: ${campaign.name}`,
          data: variables,
        }),
        renderTemplate({ template: step.bodyHtml, data: variables }),
      ]);

      let result: { messageId: string };
      try {
        result = await submitMessage(mailbox.mailcoreAccountId, {
          to: input.to,
          subject: subject.rendered,
          html: body.rendered,
          // The test goes out exactly as the campaign would, header and all.
          unsubscribeHeader: campaign.insertUnsubscribeHeader,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        void raiseAlert({
          key: "api.campaign_test_send_failed",
          title: "A campaign test send failed",
          message: detail,
          severity: "error",
          service: "api",
          context: {
            campaignId,
            campaign: campaign.name,
            mailbox: mailbox.email,
            to: input.to,
            error: detail,
          },
        });

        throw badRequest(`The test could not be sent: ${detail}`);
      }

      return {
        messageId: result.messageId,
        to: input.to,
        from: mailbox.email,
        subject: subject.rendered,
        bodyHtml: body.rendered,
      };
    },

    /* ------------------------------ mailboxes ---------------------------- */

    async assignMailboxes(campaignId: string, mailboxIds: string[]) {
      await requireCampaign(campaignId);
      await repository.assignMailboxes(campaignId, mailboxIds);
      return repository.listAssignedMailboxIds(campaignId);
    },

    /* ------------------------------ enrollment --------------------------- */

    async enrollLeads(campaignId: string, input: EnrollLeadsInput) {
      await requireCampaign(campaignId);
      await repository.enrollLeads(campaignId, input.leadIds);
      return { enrolled: input.leadIds.length };
    },

    /* ------------------------------ lists ------------------------------- */

    /** The lists attached to this campaign, with their member counts. */
    async listLists(campaignId: string) {
      await requireCampaign(campaignId);
      const lists = await listRepository.listsForCampaign(campaignId);
      return lists.map((list) => ({
        id: list.id,
        name: list.name,
        description: list.description ?? null,
        memberCount: list.memberCount ?? 0,
      }));
    },

    /** Attach a list to the campaign, enrolling everyone in it. */
    async attachList(campaignId: string, listId: string) {
      await requireCampaign(campaignId);
      const workspaceId = await ws();
      const list = await listRepository.byId(workspaceId, listId);
      if (!list) throw notFound("List");

      const memberIds = await listRepository.memberIds(listId);
      const attached = await listRepository.attach(campaignId, listId);
      const enrolled = await listRepository.enroll(campaignId, memberIds);

      return {
        attached,
        enrolled,
        members: memberIds.length,
        list: { id: list.id, name: list.name },
      };
    },

    async detachList(campaignId: string, listId: string) {
      await requireCampaign(campaignId);
      const detached = await listRepository.detach(campaignId, listId);
      if (!detached) throw notFound("Attachment");
    },
  };
}

export type CampaignService = ReturnType<typeof createCampaignService>;
