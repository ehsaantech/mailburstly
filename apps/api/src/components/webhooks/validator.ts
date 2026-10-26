import { z } from "zod";

export const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url("must be a valid URL"),
  /** Activity types to deliver. Empty means "everything". */
  events: z
    .array(
      z.enum([
        "email_sent",
        "email_opened",
        "link_clicked",
        "reply_received",
        "auto_reply",
        "bounced",
        "unsubscribed",
        "status_changed",
        "subsequence_entered",
      ]),
    )
    .max(50)
    .default([]),
  active: z.boolean().default(true),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    url: z.string().url("must be a valid URL").optional(),
    events: z
      .array(
        z.enum([
          "email_sent",
          "email_opened",
          "link_clicked",
          "reply_received",
          "auto_reply",
          "bounced",
          "unsubscribed",
          "status_changed",
          "subsequence_entered",
        ]),
      )
      .max(50)
      .optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export const webhookParamsSchema = z.object({
  id: z.string().uuid("webhook id must be a uuid"),
});
export type WebhookParams = z.infer<typeof webhookParamsSchema>;

export const deliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DeliveriesQuery = z.infer<typeof deliveriesQuerySchema>;

/* ------------------------------- api keys ------------------------------- */

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const apiKeyParamsSchema = z.object({
  id: z.string().uuid("api key id must be a uuid"),
});
export type ApiKeyParams = z.infer<typeof apiKeyParamsSchema>;
