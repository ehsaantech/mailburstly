import { z } from "zod";

export const listSubsequencesQuerySchema = z.object({
  campaignId: z.string().uuid("campaign id must be a uuid").optional(),
});
export type ListSubsequencesQuery = z.infer<typeof listSubsequencesQuerySchema>;

export const createSubsequenceSchema = z.object({
  campaignId: z.string().uuid("campaign id must be a uuid"),
  name: z.string().trim().min(1).max(200),
  trigger: z
    .enum(["reply", "reply_keyword", "status_change", "bounce", "manual"])
    .default("reply"),
  /** The word that arms a `reply_keyword` sequence. */
  triggerKeyword: z.string().trim().max(100).optional().nullable(),
  active: z.boolean().default(true),
  steps: z
    .array(
      z.object({
        subject: z.string().max(500).optional().nullable(),
        bodyHtml: z.string().min(1).max(50_000),
        delayMinutes: z.number().int().min(0).max(100_800).default(0),
      }),
    )
    .min(1)
    .max(20),
});
export type CreateSubsequenceInput = z.infer<typeof createSubsequenceSchema>;

export const updateSubsequenceSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    trigger: z
      .enum(["reply", "reply_keyword", "status_change", "bounce", "manual"])
      .optional(),
    triggerKeyword: z.string().trim().max(100).optional().nullable(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateSubsequenceInput = z.infer<typeof updateSubsequenceSchema>;

export const subsequenceParamsSchema = z.object({
  id: z.string().uuid("subsequence id must be a uuid"),
});
export type SubsequenceParams = z.infer<typeof subsequenceParamsSchema>;

export const createSubsequenceStepSchema = z.object({
  subject: z.string().max(500).optional().nullable(),
  bodyHtml: z.string().min(1).max(50_000),
  delayMinutes: z.number().int().min(0).max(100_800).default(0),
  position: z.number().int().min(1).optional(),
});
export type CreateSubsequenceStepInput = z.infer<
  typeof createSubsequenceStepSchema
>;

export const updateSubsequenceStepSchema = z
  .object({
    subject: z.string().max(500).optional().nullable(),
    bodyHtml: z.string().min(1).max(50_000).optional(),
    delayMinutes: z.number().int().min(0).max(100_800).optional(),
    position: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateSubsequenceStepInput = z.infer<
  typeof updateSubsequenceStepSchema
>;

export const subsequenceStepParamsSchema = z.object({
  id: z.string().uuid("subsequence id must be a uuid"),
  stepId: z.string().uuid("step id must be a uuid"),
});
export type SubsequenceStepParams = z.infer<typeof subsequenceStepParamsSchema>;

export const enrollLeadSchema = z.object({
  leadId: z.string().uuid("lead id must be a uuid"),
});
export type EnrollLeadInput = z.infer<typeof enrollLeadSchema>;
