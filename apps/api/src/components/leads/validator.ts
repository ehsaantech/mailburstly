import { z } from "zod";

export const createLeadSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  statusId: z.number().int().positive().optional(),
  customVariables: z.record(z.string()).optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120).optional().nullable(),
    lastName: z.string().trim().min(1).max(120).optional().nullable(),
    company: z.string().trim().min(1).max(200).optional().nullable(),
    title: z.string().trim().min(1).max(200).optional().nullable(),
    phone: z.string().trim().min(1).max(40).optional().nullable(),
    statusId: z.number().int().positive().optional().nullable(),
    emailStatus: z.enum(["unknown", "valid", "invalid", "risky", "catch_all"]).optional(),
    customVariables: z.record(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const leadParamsSchema = z.object({
  id: z.string().uuid("lead id must be a uuid"),
});
export type LeadParams = z.infer<typeof leadParamsSchema>;

export const listLeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  campaignId: z.string().uuid().optional(),
  statusId: z.coerce.number().int().positive().optional(),
  emailStatus: z.enum(["unknown", "valid", "invalid", "risky", "catch_all"]).optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

export const importLeadsSchema = z.object({
  leads: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email().max(255),
        firstName: z.string().trim().min(1).max(120).optional(),
        lastName: z.string().trim().min(1).max(120).optional(),
        company: z.string().trim().min(1).max(200).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        customVariables: z.record(z.string()).optional(),
      }),
    )
    .min(1)
    .max(10000),
});
export type ImportLeadsInput = z.infer<typeof importLeadsSchema>;