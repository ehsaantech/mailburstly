import { z } from "zod";

export const testWriterSchema = z.object({
  model: z.string().trim().min(1).max(120),
});

export const updateSettingsSchema = z
  .object({
    llm: z
      .object({
        model: z.string().trim().min(1).max(120).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        enabled: z.boolean().optional(),
        writerModel: z.string().trim().min(1).max(120).optional(),
        writerMaxTokens: z.number().int().min(64).max(8192).optional(),
        writerTimeoutMs: z.number().int().min(1000).max(120_000).optional(),
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
