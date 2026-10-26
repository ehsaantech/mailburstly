import { z } from "zod";

const provider = z.enum(["google", "microsoft", "imap_smtp"]);
const HARD_DAILY_CAP = 50;

export const createMailboxSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  displayName: z.string().trim().min(1).max(120).optional(),
  provider,
  dailyCap: z.number().int().min(10).max(HARD_DAILY_CAP).default(30),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type CreateMailboxInput = z.infer<typeof createMailboxSchema>;

export const updateMailboxSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    dailyCap: z.number().int().min(10).max(HARD_DAILY_CAP).optional(),
    replyTo: z.string().trim().toLowerCase().email().optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be supplied",
  });
export type UpdateMailboxInput = z.infer<typeof updateMailboxSchema>;

export const mailboxParamsSchema = z.object({
  id: z.string().uuid("mailbox id must be a uuid"),
});
export type MailboxParams = z.infer<typeof mailboxParamsSchema>;

export const connectMailboxSchema = z.object({
  provider: provider,
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
});
export type ConnectMailboxInput = z.infer<typeof connectMailboxSchema>;

export const callbackMailboxSchema = z.object({
  account: z.string().min(1).max(255),
  state: z.enum(["new", "existing"]).default("new"),
});
export type CallbackMailboxInput = z.infer<typeof callbackMailboxSchema>;