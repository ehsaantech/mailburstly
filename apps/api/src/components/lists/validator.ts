import { z } from "zod";

export const createListSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
});
export type CreateListInput = z.infer<typeof createListSchema>;

export const updateListSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateListInput = z.infer<typeof updateListSchema>;

export const listParamsSchema = z.object({
  id: z.string().uuid("list id must be a uuid"),
});
export type ListParams = z.infer<typeof listParamsSchema>;

export const listMemberParamsSchema = z.object({
  id: z.string().uuid("list id must be a uuid"),
  leadId: z.string().uuid("lead id must be a uuid"),
});
export type ListMemberParams = z.infer<typeof listMemberParamsSchema>;

export const addMembersSchema = z.object({
  leadIds: z.array(z.string().uuid("lead id must be a uuid")).min(1).max(10000),
});
export type AddMembersInput = z.infer<typeof addMembersSchema>;

/** The leads of a list, with a page of them. */
export const listMembersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().max(200).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

export const listCampaignParamsSchema = z.object({
  id: z.string().uuid("list id must be a uuid"),
  campaignId: z.string().uuid("campaign id must be a uuid"),
});
export type ListCampaignParams = z.infer<typeof listCampaignParamsSchema>;

/** The campaigns a list is attached to. */
export const attachToCampaignSchema = z.object({
  campaignId: z.string().uuid("campaign id must be a uuid"),
});
export type AttachToCampaignInput = z.infer<typeof attachToCampaignSchema>;
