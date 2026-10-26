import { z } from "zod";

export const overviewQuerySchema = z.object({
  /** Inclusive start date, YYYY-MM-DD. Defaults to 30 days ago. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  /** Inclusive end date, YYYY-MM-DD. Defaults to today. */
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const campaignMetricsParamsSchema = z.object({
  id: z.string().uuid("campaign id must be a uuid"),
});
export type CampaignMetricsParams = z.infer<typeof campaignMetricsParamsSchema>;

export const dailyQuerySchema = z.object({
  campaignId: z.string().uuid("campaign id must be a uuid").optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
});
export type DailyQuery = z.infer<typeof dailyQuerySchema>;

/**
 * The metrics an auto-pause rule can watch.
 *
 * These are the ones that predict trouble. A reply rate that collapses
 * means the copy is wrong; a bounce rate that climbs means the list is
 * wrong; a mailbox whose health drops means the sending is wrong.
 */
export const autoPauseMetrics = [
  "bounce_rate",
  "reply_rate",
  "open_rate",
  "spam_rate",
  "mailbox_health",
] as const;

export type AutoPauseMetric = (typeof autoPauseMetrics)[number];

export const autoPauseActions = ["pause_campaign", "pause_mailbox"] as const;
export type AutoPauseAction = (typeof autoPauseActions)[number];

export const listAutoPauseRulesQuerySchema = z.object({
  campaignId: z.string().uuid("campaign id must be a uuid").optional(),
});
export type ListAutoPauseRulesQuery = z.infer<
  typeof listAutoPauseRulesQuerySchema
>;

export const createAutoPauseRuleSchema = z.object({
  /** Null means the rule applies to every campaign. */
  campaignId: z.string().uuid("campaign id must be a uuid").nullable().optional(),
  metric: z.enum(autoPauseMetrics),
  threshold: z.number().min(0).max(1000),
  direction: z.enum(["above", "below"]).default("above"),
  action: z.enum(autoPauseActions).default("pause_campaign"),
  enabled: z.boolean().default(true),
});
export type CreateAutoPauseRuleInput = z.infer<typeof createAutoPauseRuleSchema>;

export const updateAutoPauseRuleSchema = z
  .object({
    campaignId: z.string().uuid("campaign id must be a uuid").nullable().optional(),
    metric: z.enum(autoPauseMetrics).optional(),
    threshold: z.number().min(0).max(1000).optional(),
    direction: z.enum(["above", "below"]).optional(),
    action: z.enum(autoPauseActions).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateAutoPauseRuleInput = z.infer<typeof updateAutoPauseRuleSchema>;

export const autoPauseRuleParamsSchema = z.object({
  id: z.string().uuid("rule id must be a uuid"),
});
export type AutoPauseRuleParams = z.infer<typeof autoPauseRuleParamsSchema>;

/* ------------------------------ activity --------------------------------- */

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
  type: z
    .enum([
      "email_sent",
      "email_opened",
      "link_clicked",
      "reply_received",
      "auto_reply",
      "bounced",
      "unsubscribed",
      "status_changed",
      "subsequence_entered",
    ])
    .optional(),
  campaignId: z.string().uuid("campaign id must be a uuid").optional(),
  leadId: z.string().uuid("lead id must be a uuid").optional(),
  mailboxId: z.string().uuid("mailbox id must be a uuid").optional(),
  stepId: z.string().uuid("step id must be a uuid").optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

/* ------------------------------- export ---------------------------------- */

export const exportQuerySchema = z.object({
  campaignId: z.string().uuid("campaign id must be a uuid").optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
  /** "activity" is the raw log; "daily" is the rollup. */
  dataset: z.enum(["activity", "daily"]).default("activity"),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;
