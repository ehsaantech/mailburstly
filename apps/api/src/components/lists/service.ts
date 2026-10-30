import { badRequest, conflict, notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import { createListRepository } from "./repository";
import type {
  AddMembersInput,
  AttachToCampaignInput,
  CreateListInput,
  ListMembersQuery,
  UpdateListInput,
} from "./validator";

export interface ListServiceDeps {
  db: DbHandle;
  workspaceId: string | (() => Promise<string>);
}

export function createListService(deps: ListServiceDeps) {
  const repository = createListRepository({ db: deps.db.db });

  const ws = async () =>
    typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId;

  const requireList = async (id: string) => {
    const row = await repository.byId(await ws(), id);
    if (!row) throw notFound("List");
    return row;
  };

  return {
    /** Every list, with its counts. */
    async list() {
      const rows = await repository.list(await ws());
      return rows.map((r) => ({
        id: r.list.id,
        name: r.list.name,
        description: r.list.description,
        createdAt: r.list.createdAt.toISOString(),
        memberCount: r.memberCount,
        campaignCount: r.campaignCount,
      }));
    },

    async get(id: string) {
      const row = await requireList(id);
      const [breakdown, campaignList] = await Promise.all([
        repository.memberBreakdown(id),
        repository.campaignsForList(id),
      ]);

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.createdAt.toISOString(),
        breakdown,
        campaigns: campaignList,
      };
    },

    async create(input: CreateListInput) {
      const existing = await repository.byName(await ws(), input.name);
      if (existing) {
        throw conflict("A list with that name already exists");
      }

      return repository.create({
        workspaceId: await ws(),
        name: input.name,
        description: input.description ?? null,
      });
    },

    async update(id: string, input: UpdateListInput) {
      await requireList(id);

      if (input.name) {
        const existing = await repository.byName(await ws(), input.name);
        if (existing && existing.id !== id) {
          throw conflict("A list with that name already exists");
        }
      }

      const patch: { name?: string; description?: string | null } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;

      return repository.update(await ws(), id, patch);
    },

    /**
     * Deletes a list.
     *
     * The leads are not touched. A list is a view over the workspace's
     * leads, and deleting it must never delete a contact.
     */
    async remove(id: string) {
      await requireList(id);
      await repository.remove(await ws(), id);
    },

    /** Copies a list and its members under a new name. */
    async duplicate(id: string) {
      const row = await requireList(id);

      const name = await this.uniqueName(`${row.name} (copy)`);
      const copy = await repository.create({
        workspaceId: await ws(),
        name,
        description: row.description,
      });

      const memberIds = await repository.memberIds(id);
      await repository.addMembers(copy.id, memberIds);

      return copy;
    },

    /* ----------------------------- members ------------------------------ */

    async members(id: string, query: ListMembersQuery) {
      await requireList(id);
      const { items, total } = await repository.members(id, query);

      return {
        total,
        items: items.map((row) => ({
          id: row.lead.id,
          email: row.lead.email,
          firstName: row.lead.firstName,
          lastName: row.lead.lastName,
          company: row.lead.company,
          title: row.lead.title,
          emailStatus: row.lead.emailStatus,
          statusId: row.lead.statusId,
          statusName: row.statusName,
          statusInterest: row.statusInterest,
          addedAt: row.member.addedAt.toISOString(),
        })),
      };
    },

    /**
     * Adds leads to a list.
     *
     * When the list is attached to a running campaign that enrolls on add,
     * the new leads are enrolled straight away — a list that is attached but
     * silent is a surprise waiting to happen.
     */
    async addMembers(id: string, input: AddMembersInput) {
      await requireList(id);

      const added = await repository.addMembers(id, input.leadIds);

      const campaigns = await repository.campaignsForList(id);
      let enrolled = 0;

      for (const campaign of campaigns) {
        if (campaign.status !== "active") continue;
        if (!campaign.enrollOnAdd) continue;
        enrolled += await repository.enroll(campaign.campaignId, added);
      }

      return {
        added: added.length,
        skipped: input.leadIds.length - added.length,
        enrolled,
      };
    },

    async removeMember(id: string, leadId: string) {
      await requireList(id);
      const removed = await repository.removeMember(id, leadId);
      if (!removed) throw notFound("List member");
    },

    async listWatchers(id: string) {
      await requireList(id);
      return repository.listWatchers(id);
    },

    async replaceWatchers(id: string, userIds: string[]) {
      await requireList(id);
      return repository.replaceWatchers(id, userIds);
    },

    /* ------------------------ campaign attachment ----------------------- */

    /**
     * Attaches a list to a campaign, enrolling everyone in it.
     */
    async attachToCampaign(listId: string, input: AttachToCampaignInput) {
      await requireList(listId);

      const memberIds = await repository.memberIds(listId);
      const attached = await repository.attach(input.campaignId, listId);
      const enrolled = await repository.enroll(input.campaignId, memberIds);

      return { attached, enrolled, members: memberIds.length };
    },

    async detachFromCampaign(listId: string, campaignId: string) {
      await requireList(listId);
      const detached = await repository.detach(campaignId, listId);
      if (!detached) throw notFound("Attachment");
    },

    /** A name that is not taken, so a copy never collides. */
    async uniqueName(base: string): Promise<string> {
      let candidate = base;
      let n = 2;

      while (await repository.byName(await ws(), candidate)) {
        candidate = `${base} ${n}`;
        n++;
        if (n > 100) {
          throw badRequest("Could not find a free name for the copy");
        }
      }

      return candidate;
    },
  };
}

export type ListService = ReturnType<typeof createListService>;
