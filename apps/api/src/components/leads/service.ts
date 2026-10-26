import { fromPostgresError, notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import {
  createLeadRepository,
  type LeadRow,
} from "./repository";
import type {
  CreateLeadInput,
  ImportLeadsInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from "./validator";

export interface LeadServiceDeps {
  db: DbHandle;
  workspaceId: string | (() => Promise<string>);
}

export function createLeadService(deps: LeadServiceDeps) {
  const repository = createLeadRepository({ db: deps.db.db });

  const ws = async () =>
    typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId;

  const requireLead = async (id: string) => {
    const row = await repository.byId(await ws(), id);
    if (!row) throw notFound("Lead");
    return row;
  };

  return {
    async list(query: ListLeadsQuery) {
      const [items, total] = await Promise.all([
        repository.list(await ws(), query),
        repository.count(await ws(), query),
      ]);
      return { items, total };
    },

    async get(id: string) {
      return requireLead(id);
    },

    async create(input: CreateLeadInput) {
      const existing = await repository.byEmail(await ws(), input.email);
      if (existing) throw fromPostgresError({ code: "23505" });
      return repository.create({
        workspaceId: await ws(),
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        company: input.company ?? null,
        title: input.title ?? null,
        phone: input.phone ?? null,
        statusId: input.statusId ?? null,
        customVariables: input.customVariables ?? {},
      });
    },

    async update(id: string, patch: UpdateLeadInput) {
      await requireLead(id);
      const dbPatch: Record<string, unknown> = {};
      if (patch.firstName !== undefined) dbPatch.firstName = patch.firstName;
      if (patch.lastName !== undefined) dbPatch.lastName = patch.lastName;
      if (patch.company !== undefined) dbPatch.company = patch.company;
      if (patch.title !== undefined) dbPatch.title = patch.title;
      if (patch.phone !== undefined) dbPatch.phone = patch.phone;
      if (patch.statusId !== undefined) dbPatch.statusId = patch.statusId;
      if (patch.emailStatus !== undefined) dbPatch.emailStatus = patch.emailStatus;
      if (patch.customVariables !== undefined) dbPatch.customVariables = patch.customVariables;
      const updated = await repository.update(await ws(), id, dbPatch);
      if (!updated) throw notFound("Lead");
      return updated;
    },

    async remove(id: string) {
      await requireLead(id);
      await repository.remove(await ws(), id);
    },

    async importLeads(input: ImportLeadsInput) {
      const wsId = await ws();
      const created: LeadRow[] = [];
      // Every lead we touch — created or pre-existing — gets a stable id back
      // so a caller (e.g. the campaign importer) can enroll them without a
      // second lookup.
      const leadIds: string[] = [];
      for (const lead of input.leads) {
        let row = await repository.byEmail(wsId, lead.email);
        if (!row) {
          row = await repository.create({
            workspaceId: wsId,
            email: lead.email,
            firstName: lead.firstName ?? null,
            lastName: lead.lastName ?? null,
            company: lead.company ?? null,
            title: lead.title ?? null,
            customVariables: lead.customVariables ?? {},
          });
          created.push(row);
        }
        leadIds.push(row.id);
      }
      return {
        created: created.length,
        skipped: input.leads.length - created.length,
        leadIds,
      };
    },

    async listLabels() {
      return repository.listLabels(await ws());
    },
  };
}

export type LeadService = ReturnType<typeof createLeadService>;