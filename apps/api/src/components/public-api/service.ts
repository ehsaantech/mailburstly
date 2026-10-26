import type { DbHandle } from "@/db";
import { createPublicRepository } from "./repository";

export interface PublicApiServiceDeps {
  db: DbHandle;
}

export function createPublicApiService(deps: PublicApiServiceDeps) {
  const repository = createPublicRepository({ db: deps.db.db });

  return {
    async campaigns(workspaceId: string, limit: number, offset: number) {
      return repository.listCampaigns(workspaceId, limit, offset);
    },

    async leads(
      workspaceId: string,
      query: { limit: number; offset: number; statusId?: number; search?: string },
    ) {
      return repository.listLeads(workspaceId, query);
    },

    async leadCampaigns(workspaceId: string, leadId: string) {
      return repository.leadCampaigns(workspaceId, leadId);
    },
  };
}

export type PublicApiService = ReturnType<typeof createPublicApiService>;
