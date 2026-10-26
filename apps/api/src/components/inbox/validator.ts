import { z } from "zod";

/**
 * The inbox folders.
 *
 * These map onto the way an operator actually works: what needs an answer
 * now, what is waiting, what we sent but never heard back about.
 */
export const inboxFolders = [
  "primary",
  "unread",
  "reminders",
  "scheduled",
  "sent",
  "others",
  "archived",
] as const;

export type InboxFolder = (typeof inboxFolders)[number];

export const listConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["open", "closed", "archived"]).optional(),
  /** The folder to show. Defaults to "primary". */
  folder: z.enum(inboxFolders).optional(),
  /** Only conversations with a reply, or every one. */
  hasReply: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  search: z.string().trim().max(200).optional(),
  campaignId: z.string().uuid("campaign id must be a uuid").optional(),
  mailboxId: z.string().uuid("mailbox id must be a uuid").optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const conversationParamsSchema = z.object({
  id: z.string().uuid("conversation id must be a uuid"),
});
export type ConversationParams = z.infer<typeof conversationParamsSchema>;

export const updateConversationSchema = z
  .object({
    status: z.enum(["open", "closed", "archived"]).optional(),
    read: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

/** Sends a reply straight away. */
export const replySchema = z.object({
  bodyHtml: z.string().min(1).max(50_000),
  bodyText: z.string().max(50_000).optional(),
  /** Overrides the "Re: <original subject>" default. */
  subject: z.string().max(500).optional(),
});
export type ReplyInput = z.infer<typeof replySchema>;

/** Schedules a reply for later. */
export const scheduleReplySchema = z.object({
  bodyHtml: z.string().min(1).max(50_000),
  bodyText: z.string().max(50_000).optional(),
  subject: z.string().max(500).optional(),
  sendAt: z.string().datetime({ message: "sendAt must be an ISO timestamp" }),
});
export type ScheduleReplyInput = z.infer<typeof scheduleReplySchema>;

/** Sets or clears a reminder. */
export const remindSchema = z.object({
  /** Null clears the reminder. */
  remindAt: z.string().datetime({ message: "remindAt must be an ISO timestamp" }).nullable(),
});
export type RemindInput = z.infer<typeof remindSchema>;

/** Links an unmatched conversation to a lead. */
export const attachLeadSchema = z.object({
  leadId: z.string().uuid("lead id must be a uuid"),
});
export type AttachLeadInput = z.infer<typeof attachLeadSchema>;

export const listOpportunitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["open", "won", "lost"]).optional(),
  campaignId: z.string().uuid("campaign id must be a uuid").optional(),
});
export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;

export const opportunityParamsSchema = z.object({
  id: z.string().uuid("opportunity id must be a uuid"),
});
export type OpportunityParams = z.infer<typeof opportunityParamsSchema>;

export const updateOpportunitySchema = z
  .object({
    status: z.enum(["open", "won", "lost"]).optional(),
    value: z.number().min(0).nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const messageParamsSchema = z.object({
  id: z.string().uuid("message id must be a uuid"),
});
export type MessageParams = z.infer<typeof messageParamsSchema>;

export const leadStatusParamsSchema = z.object({
  id: z.string().uuid("lead id must be a uuid"),
});
export type LeadStatusParams = z.infer<typeof leadStatusParamsSchema>;

/**
 * Asks for a suggested reply.
 *
 * The operator can steer it: a different tone, or extra instructions like
 * "they asked about enterprise pricing, say we will follow up".
 */
export const suggestSchema = z.object({
  /** How the reply should read. */
  tone: z
    .enum(["direct", "warm", "brief", "detailed"])
    .default("direct"),
  /** Extra guidance for this one reply. */
  instructions: z.string().trim().max(1000).optional(),
});
export type SuggestInput = z.infer<typeof suggestSchema>;

/* ------------------------------- macros ---------------------------------- */

export const createMacroSchema = z.object({
  name: z.string().trim().min(1).max(120),
  bodyHtml: z.string().min(1).max(20_000),
  bodyText: z.string().max(20_000).optional(),
});
export type CreateMacroInput = z.infer<typeof createMacroSchema>;

export const updateMacroSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    bodyHtml: z.string().min(1).max(20_000).optional(),
    bodyText: z.string().max(20_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateMacroInput = z.infer<typeof updateMacroSchema>;

export const macroParamsSchema = z.object({
  id: z.string().uuid("macro id must be a uuid"),
});
export type MacroParams = z.infer<typeof macroParamsSchema>;
