import { z } from "zod";

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dailyLimit: z.number().int().min(1).max(10000).optional(),
  dailyMaxLeads: z.number().int().min(0).max(10000).optional(),
  emailGapMinutes: z.number().int().min(1).max(60).default(9),
  randomWaitMax: z.number().int().min(0).max(30).default(5),
  stopOnReply: z.boolean().default(true),
  stopOnAutoReply: z.boolean().default(false),
  stopForCompany: z.boolean().default(true),
  openTracking: z.boolean().default(true),
  linkTracking: z.boolean().default(true),
  textOnly: z.boolean().default(false),
  insertUnsubscribeHeader: z.boolean().default(true),
  allowRiskyContacts: z.boolean().default(false),
  schedule: z
    .object({
      mode: z.enum(["always", "office_hours", "custom"]).default("always"),
      rules: z
        .array(
          z.object({
            daysOfWeek: z.array(z.number().int().min(0).max(6)),
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
            timezone: z.string().min(1),
          }),
        )
        .default([]),
    })
    .default({ mode: "always", rules: [] }),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    dailyLimit: z.number().int().min(1).max(10000).optional().nullable(),
    dailyMaxLeads: z.number().int().min(0).max(10000).optional().nullable(),
    emailGapMinutes: z.number().int().min(1).max(60).optional(),
    randomWaitMax: z.number().int().min(0).max(30).optional(),
    stopOnReply: z.boolean().optional(),
    stopOnAutoReply: z.boolean().optional(),
    stopForCompany: z.boolean().optional(),
    openTracking: z.boolean().optional(),
    linkTracking: z.boolean().optional(),
    textOnly: z.boolean().optional(),
    insertUnsubscribeHeader: z.boolean().optional(),
    allowRiskyContacts: z.boolean().optional(),
    schedule: z
      .object({
        mode: z.enum(["always", "office_hours", "custom"]),
        rules: z.array(
          z.object({
            daysOfWeek: z.array(z.number().int().min(0).max(6)),
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
            timezone: z.string().min(1),
          }),
        ),
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const campaignParamsSchema = z.object({
  id: z.string().uuid("campaign id must be a uuid"),
});
export type CampaignParams = z.infer<typeof campaignParamsSchema>;

export const createStepSchema = z.object({
  subject: z.string().max(500).optional(),
  bodyHtml: z.string().min(1).max(50000),
  bodyText: z.string().max(50000).optional(),
  preheader: z.string().max(200).optional(),
  delayMinutes: z.number().int().min(0).max(100800).default(0),
  threadMode: z.enum(["reply", "new_thread"]).default("reply"),
  position: z.number().int().min(1).optional(),
});
export type CreateStepInput = z.infer<typeof createStepSchema>;

export const updateStepSchema = z
  .object({
    subject: z.string().max(500).optional().nullable(),
    bodyHtml: z.string().min(1).max(50000).optional(),
    bodyText: z.string().max(50000).optional().nullable(),
    preheader: z.string().max(200).optional().nullable(),
    delayMinutes: z.number().int().min(0).max(100800).optional(),
    threadMode: z.enum(["reply", "new_thread"]).optional(),
    position: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateStepInput = z.infer<typeof updateStepSchema>;

export const stepParamsSchema = z.object({
  id: z.string().uuid("step id must be a uuid"),
  stepId: z.string().uuid("step id must be a uuid"),
});
export type StepParams = z.infer<typeof stepParamsSchema>;

export const createVariantSchema = z.object({
  label: z.string().trim().min(1).max(40),
  subject: z.string().max(500).optional().nullable(),
  bodyHtml: z.string().min(1).max(50_000),
  /** The share of sends that get this variant. */
  weight: z.number().int().min(1).max(100).default(100),
  /** Pinned variants always win, whatever their weight. */
  pinned: z.boolean().default(false),
});
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = z
  .object({
    label: z.string().trim().min(1).max(40).optional(),
    subject: z.string().max(500).optional().nullable(),
    bodyHtml: z.string().min(1).max(50_000).optional(),
    weight: z.number().int().min(1).max(100).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

/** The order the steps should be in. */
export const reorderStepsSchema = z.object({
  /** The step ids, in the order they should appear. */
  stepIds: z.array(z.string().uuid("step id must be a uuid")).min(1).max(50),
});
export type ReorderStepsInput = z.infer<typeof reorderStepsSchema>;

export const variantParamsSchema = z.object({
  id: z.string().uuid("campaign id must be a uuid"),
  stepId: z.string().uuid("step id must be a uuid"),
  variantId: z.string().uuid("variant id must be a uuid"),
});
export type VariantParams = z.infer<typeof variantParamsSchema>;

/**
 * Renders a step without sending it, so the operator can see the message
 * with real values in it before it goes out.
 */
export const previewStepSchema = z.object({
  stepId: z.string().uuid("step id must be a uuid").optional(),
  /** Render against this lead's data. */
  leadId: z.string().uuid("lead id must be a uuid").optional(),
  /** Or against these values. */
  data: z.record(z.string(), z.string().max(2000)).optional(),
});
export type PreviewStepInput = z.infer<typeof previewStepSchema>;

/** Sends a test of the sequence to one address. */
export const testSendSchema = z.object({
  /** Which step to send. Defaults to the first one. */
  stepId: z.string().uuid("step id must be a uuid").optional(),
  /** Where to send it. */
  to: z.string().email("a valid email address is required"),
  /** Render against this lead's data, if there is one. */
  leadId: z.string().uuid("lead id must be a uuid").optional(),
  /** Or against these values. */
  data: z.record(z.string(), z.string().max(2000)).optional(),
});
export type TestSendInput = z.infer<typeof testSendSchema>;

export const enrollLeadsSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(10000),
});
export type EnrollLeadsInput = z.infer<typeof enrollLeadsSchema>;

export const attachListSchema = z.object({
  listId: z.string().uuid("list id must be a uuid"),
});
export type AttachListInput = z.infer<typeof attachListSchema>;
export const assignMailboxesSchema = z.object({
  mailboxIds: z.array(z.string().uuid()).max(100),
});
export type AssignMailboxesInput = z.infer<typeof assignMailboxesSchema>;
