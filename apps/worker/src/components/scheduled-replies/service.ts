import type { Logger } from "@/core/logger";
import { raiseAlert } from "@/lib/alerts";
import {
  createMailcoreClient,
  type MailcoreClient,
} from "@/lib/mailcore";
import {
  createScheduledReplyRepository,
  type ScheduledReplyRepository,
} from "./repository";

export interface ScheduledReplyServiceDeps {
  db: { db: Parameters<typeof createScheduledReplyRepository>[0]["db"] };
  log: Logger;
  mailcore: { baseUrl: string; apiKey: string; timeoutMs?: number };
}

/** The draft the operator scheduled, as stored on the conversation. */
interface ScheduledDraft {
  bodyHtml: string;
  bodyText: string | null;
  subject: string;
}

export function createScheduledReplyService(deps: ScheduledReplyServiceDeps) {
  const repo: ScheduledReplyRepository = createScheduledReplyRepository({
    db: deps.db.db,
  });
  const { log } = deps;

  const client: MailcoreClient = createMailcoreClient({
    baseUrl: deps.mailcore.baseUrl,
    apiKey: deps.mailcore.apiKey,
    timeoutMs: deps.mailcore.timeoutMs ?? 20_000,
  });

  return {
    /**
     * Sends every scheduled reply that is due.
     *
     * A scheduled reply that fails is **not** retried forever: the draft is
     * cleared either way, and the failure is logged. A reply stuck in the
     * queue forever is worse than a reply that did not go out — the operator
     * can see the conversation is still open and write it again.
     */
    async run(): Promise<void> {
      const now = new Date();
      const due = await repo.due(now);
      if (due.length === 0) return;

      for (const row of due) {
        const raw = row.conversation.scheduledReplyBody;
        if (!raw) {
          await repo.clearScheduled(row.conversation.id);
          continue;
        }

        let draft: ScheduledDraft;
        try {
          draft = JSON.parse(raw) as ScheduledDraft;
        } catch {
          log.warn("scheduled reply draft was not valid json — dropping it", {
            conversationId: row.conversation.id,
          });
          await repo.clearScheduled(row.conversation.id);
          continue;
        }

        const parent = await repo.lastInboundMessage(row.conversation.id);

        try {
          const result = await client.submit(row.mailboxMailcoreAccountId, {
            to: row.conversation.contactEmail,
            subject: draft.subject,
            html: draft.bodyHtml,
            text: draft.bodyText ?? undefined,
            inReplyTo: parent?.providerMessageId ?? undefined,
          });

          await repo.insertMessage({
            workspaceId: row.conversation.workspaceId,
            conversationId: row.conversation.id,
            mailboxId: row.conversation.mailboxId,
            leadId: row.conversation.leadId,
            campaignId: row.conversation.campaignId,
            providerMessageId: result.messageId || null,
            direction: "outbound",
            fromAddress: row.mailboxEmail,
            toAddress: row.conversation.contactEmail,
            subject: draft.subject,
            textBody: draft.bodyText,
            htmlBody: draft.bodyHtml,
            snippet: draft.bodyText,
            classification: "other",
            isAutoReply: 0,
            isOutOfOffice: 0,
            oooResumeAt: null,
            isUnsubscribe: 0,
            receivedAt: new Date(),
          });

          await repo.recordActivity({
            workspaceId: row.conversation.workspaceId,
            campaignId: row.conversation.campaignId,
            leadId: row.conversation.leadId,
            mailboxId: row.conversation.mailboxId,
            stepId: null,
            variantId: null,
            type: "email_sent",
            meta: { subject: draft.subject, scheduled: true },
          });

          log.info("scheduled reply sent", {
            conversationId: row.conversation.id,
            to: row.conversation.contactEmail,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);

          log.error("scheduled reply failed", {
            conversationId: row.conversation.id,
            error: detail,
          });

          // The draft is dropped either way, so this reply is never going
          // out. The operator needs to know: they scheduled it, and it is
          // gone.
          void raiseAlert({
            key: "worker.scheduled_reply_failed",
            title: "A scheduled reply could not be sent",
            message: detail,
            severity: "error",
            service: "worker",
            context: {
              conversationId: row.conversation.id,
              to: row.conversation.contactEmail,
              mailbox: row.mailboxEmail,
              error: detail,
            },
          });
        } finally {
          await repo.clearScheduled(row.conversation.id);
        }
      }
    },
  };
}

export type ScheduledReplyService = ReturnType<typeof createScheduledReplyService>;
