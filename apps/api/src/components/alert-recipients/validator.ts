import { z } from "zod";

export const createAlertRecipientSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("must be a valid email address")
    .max(320),
  name: z.string().trim().max(200).optional().nullable(),
  severity: z.enum(["error", "warning"]).default("error"),
  enabled: z.boolean().default(true),
});
export type CreateAlertRecipientInput = z.infer<
  typeof createAlertRecipientSchema
>;

export const updateAlertRecipientSchema = z
  .object({
    name: z.string().trim().max(200).optional().nullable(),
    severity: z.enum(["error", "warning"]).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateAlertRecipientInput = z.infer<
  typeof updateAlertRecipientSchema
>;

export const alertRecipientParamsSchema = z.object({
  id: z.string().uuid("recipient id must be a uuid"),
});
export type AlertRecipientParams = z.infer<typeof alertRecipientParamsSchema>;
