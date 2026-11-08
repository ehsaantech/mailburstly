import {
  isBlockingIssue,
  normalizeEmail,
  validateLeadRow,
  type LeadRowError,
} from "@mailrung/shared";

import { fromPostgresError, notFound } from "@/core/errors";
import type { Database, DbHandle } from "@/db";
import {
  createLeadRepository,
  type LeadRepository,
  type LeadRow,
} from "./repository";
import type {
  CreateLeadInput,
  ImportLeadsInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from "./validator";

export interface LeadServiceDeps {
  /** The database handle. Optional when a repository is injected. */
  db?: DbHandle;
  workspaceId: string | (() => Promise<string>);
  /**
   * A repository built by hand. The api never passes one; the tests do, so
   * the import policy can be checked without a database.
   */
  repository?: LeadRepository;
}

export function createLeadService(deps: LeadServiceDeps) {
  const repository =
    deps.repository ?? createLeadRepository({ db: requireDb(deps.db) });

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
        linkedinUrl: input.linkedinUrl ?? null,
        photoUrl: input.photoUrl ?? null,
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
      if (patch.linkedinUrl !== undefined) dbPatch.linkedinUrl = patch.linkedinUrl;
      if (patch.photoUrl !== undefined) dbPatch.photoUrl = patch.photoUrl;
      if (patch.statusId !== undefined) dbPatch.statusId = patch.statusId;
      if (patch.emailStatus !== undefined) dbPatch.emailStatus = patch.emailStatus;
      if (patch.customVariables !== undefined) {
        dbPatch.customVariables = patch.customVariables;
      }
      const updated = await repository.update(await ws(), id, dbPatch);
      if (!updated) throw notFound("Lead");
      return updated;
    },

    async remove(id: string) {
      await requireLead(id);
      await repository.remove(await ws(), id);
    },

    /**
     * Imports a batch of leads.
     *
     * The policy, in one paragraph so nobody has to guess:
     *
     *   - A row whose email is missing, malformed or over-long is
     *     *rejected*. It comes back in `errors` with its row number and the
     *     reason. It never stops the other rows from being imported.
     *   - A row whose email already exists — in the workspace or earlier in
     *     the same batch — is *skipped*. That is a no-op, not a failure.
     *
     * `leadIds` holds every lead the batch touched (created or already
     * there), so the caller can enrol them in a campaign without a second
     * lookup.
     */
    async importLeads(input: ImportLeadsInput) {
      const wsId = await ws();
      const created: LeadRow[] = [];
      const leadIds: string[] = [];
      const errors: LeadRowError[] = [];
      const seen = new Set<string>();
      let skipped = 0;

      for (const [index, lead] of input.leads.entries()) {
        const values = {
          email: lead.email ?? "",
          firstName: lead.firstName ?? "",
          lastName: lead.lastName ?? "",
          company: lead.company ?? "",
          title: lead.title ?? "",
          phone: lead.phone ?? "",
          linkedinUrl: lead.linkedinUrl ?? "",
          photoUrl: lead.photoUrl ?? "",
        };

        const issues = validateLeadRow(values, { seenEmails: seen });
        const blocking = issues.filter(isBlockingIssue);
        if (blocking.length > 0) {
          errors.push({
            row: index + 1,
            email: lead.email ?? "",
            code: blocking[0]!.code,
            message: blocking[0]!.message,
          });
          continue;
        }

        const email = normalizeEmail(lead.email ?? "");
        seen.add(email);

        const existing = await repository.byEmail(wsId, email);
        if (existing) {
          skipped += 1;
          leadIds.push(existing.id);
          continue;
        }

        const row = await repository.create({
          workspaceId: wsId,
          email,
          firstName: lead.firstName ?? null,
          lastName: lead.lastName ?? null,
          company: lead.company ?? null,
          title: lead.title ?? null,
          phone: lead.phone ?? null,
          linkedinUrl: lead.linkedinUrl?.trim() || null,
          photoUrl: lead.photoUrl?.trim() || null,
          customVariables: toStringRecord(lead.customVariables),
        });
        created.push(row);
        leadIds.push(row.id);
      }

      return {
        created: created.length,
        skipped,
        rejected: errors.length,
        leadIds,
        errors,
      };
    },

    async listLabels() {
      return repository.listLabels(await ws());
    },
  };
}

/** The database handle, when the service was not given a repository. */
function requireDb(db: DbHandle | undefined): Database {
  if (!db) throw new Error("createLeadService needs a db handle");
  return db.db;
}

/** Custom variables arrive as strings, but a sheet cell may be a number. */
function toStringRecord(
  values: Record<string, string | number | boolean> | null | undefined,
): Record<string, string> {
  if (!values) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

export type LeadService = ReturnType<typeof createLeadService>;
