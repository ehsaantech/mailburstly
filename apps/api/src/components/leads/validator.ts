import { z } from "zod";

export const createLeadSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  linkedinUrl: z.string().trim().min(1).max(2048).optional(),
  photoUrl: z.string().trim().min(1).max(2048).optional(),
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
    linkedinUrl: z.string().trim().min(1).max(2048).optional().nullable(),
    photoUrl: z.string().trim().min(1).max(2048).optional().nullable(),
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

/**
 * An import batch.
 *
 * The rows are deliberately loose here: a single broken address must not
 * fail the other nine thousand. Every row is validated on its own by the
 * service (`validateLeadRow`), which reports the bad ones with their row
 * number and imports the rest. The limits here are only a guard against a
 * malformed request, not the real field limits.
 */
export const importLeadsSchema = z.object({
  leads: z
    .array(
      z.object({
        email: z.string().max(2000).nullish(),
        firstName: z.string().max(2000).nullish(),
        lastName: z.string().max(2000).nullish(),
        company: z.string().max(2000).nullish(),
        title: z.string().max(2000).nullish(),
        phone: z.string().max(2000).nullish(),
        linkedinUrl: z.string().max(4096).nullish(),
        photoUrl: z.string().max(4096).nullish(),
        customVariables: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .nullish(),
      }),
    )
    .min(1)
    .max(10000),
});
export type ImportLeadsInput = z.infer<typeof importLeadsSchema>;