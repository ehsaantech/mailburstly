import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    llm: z
      .object({
        model: z.string().trim().min(1).max(120),
        minConfidence: z.number().min(0).max(1),
        enabled: z.boolean(),
      })
      .optional(),
    replyRateThreshold: z.number().min(0).max(100).optional(),
    defaultMailboxDailyCap: z.number().int().min(1).max(100).optional(),
    defaultMinGapSeconds: z.number().int().min(0).max(86_400).optional(),
    defaultRandomJitterSeconds: z
      .number()
      .int()
      .min(0)
      .max(86_400)
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
