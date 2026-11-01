import { badRequest, badGateway, notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import { submitMessage } from "@/lib/mailcore";
import { raiseAlert } from "@/lib/alerts";
import { chat, stripFence, SUGGEST_SYSTEM_PROMPT } from "@/lib/llm";
import { isDecisionModel } from "@/components/settings/service";
import { createInboxRepository } from "./repository";
import type {
  AttachLeadInput,
  CreateMacroInput,
  ListConversationsQuery,
  ListOpportunitiesQuery,
  MacroParams,
  RemindInput,
  ReplyInput,
  ScheduleReplyInput,
  SuggestInput,
  UpdateConversationInput,
  UpdateMacroInput,
  UpdateOpportunityInput,
} from "./validator";

export interface InboxServiceDeps {
  db: DbHandle;
  workspaceId: string | (() => Promise<string>);
}

export function createInboxService(deps: InboxServiceDeps) {
  const repository = createInboxRepository({ db: deps.db.db });

  const ws = async () =>
    typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId;

  const requireConversation = async (id: string) => {
    const row = await repository.conversationById(await ws(), id);
    if (!row) throw notFound("Conversation");
    return row;
  };

  /** "Re: <subject>", unless the subject already says that. */
  function replySubject(subject: string | null): string {
    const base = subject ?? "(no subject)";
    return /^re:/i.test(base) ? base : `Re: ${base}`;
  }

  return {
    /** Conversations, newest activity first. */
    async listConversations(query: ListConversationsQuery) {
      const workspaceId = await ws();
      const [items, total] = await Promise.all([
        repository.listConversations(workspaceId, query),
        repository.countConversations(workspaceId, query),
      ]);
      return { items, total };
    },

    /** One conversation with every message in it. */
    async getConversation(id: string) {
      const row = await requireConversation(id);

      const thread = await repository.messagesForConversation(id);

      return {
        ...row,
        lead: row.leadId
          ? {
              id: row.leadId,
              firstName: row.leadFirstName,
              lastName: row.leadLastName,
              company: row.leadCompany,
            }
          : null,
        messages: thread,
      };
    },

    /** Change a conversation's state, or mark it read. */
    async updateConversation(id: string, input: UpdateConversationInput) {
      await requireConversation(id);

      if (input.read) {
        await repository.markConversationRead(id);
        await repository.updateConversation(id, { hasUnread: 0 });
      }

      if (input.status) {
        return repository.updateConversation(id, { status: input.status });
      }

      return repository.conversationById(await ws(), id);
    },

    /**
     * Sends a reply to the contact.
     *
     * A manual reply is a human deciding the lead is engaged. It is
     * recorded as an outbound message and an activity, and — when the
     * campaign says `stop_on_reply` — it stops the lead's sequence, because
     * continuing to email someone who just wrote back is how a domain gets
     * blocked.
     */
    async reply(id: string, input: ReplyInput) {
      const row = await requireConversation(id);
      const workspaceId = await ws();

      const parent = await repository.lastInboundMessage(id);
      const subject = input.subject ?? replySubject(row.subject);

      let result: { messageId: string; queueId?: string };
      try {
        result = await submitMessage(row.mailboxMailcoreAccountId, {
          to: row.contactEmail,
          subject,
          html: input.bodyHtml,
          text: input.bodyText,
          inReplyTo: parent?.providerMessageId ?? undefined,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        // The reply did not go out. That is exactly the kind of failure
        // worth an email: the operator believes they answered the lead.
        void raiseAlert({
          key: "api.reply_send_failed",
          title: "A reply could not be sent",
          message: detail,
          severity: "error",
          service: "api",
          context: {
            conversationId: id,
            to: row.contactEmail,
            mailbox: row.mailboxEmail,
            error: detail,
          },
        });

        // A transport failure is a bad request from the operator's point of
        // view — the mailbox may be disconnected, or the address rejected.
        // A 500 would hide the reason.
        throw badRequest(`The reply could not be sent: ${detail}`);
      }

      await repository.insertMessage({
        workspaceId,
        conversationId: id,
        mailboxId: row.mailboxId,
        leadId: row.leadId,
        campaignId: row.campaignId,
        providerMessageId: result.messageId || null,
        direction: "outbound",
        fromAddress: row.mailboxEmail,
        toAddress: row.contactEmail,
        subject,
        textBody: input.bodyText ?? null,
        htmlBody: input.bodyHtml,
        snippet: input.bodyText ?? null,
        classification: "other",
        isAutoReply: 0,
        isOutOfOffice: 0,
        oooResumeAt: null,
        isUnsubscribe: 0,
        receivedAt: new Date(),
      });

      await repository.updateConversation(id, { hasUnread: 0 });

      await repository.recordActivity({
        workspaceId,
        campaignId: row.campaignId,
        leadId: row.leadId,
        mailboxId: row.mailboxId,
        stepId: null,
        variantId: null,
        type: "email_sent",
        meta: { subject, manual: true, messageId: result.messageId },
      });

      // Honour stop_on_reply: a human answered, so the sequence stops.
      if (row.leadId && row.campaignId) {
        const enrollment = await repository.campaignLeadFor(
          row.leadId,
          row.campaignId,
        );
        if (enrollment?.stopOnReply) {
          await repository.stopCampaignLead(
            enrollment.campaignLead.id,
            "replied",
          );
        }
      }

      return {
        messageId: result.messageId,
        sentAt: new Date().toISOString(),
      };
    },

    /**
     * Schedules a reply for later.
     *
     * The worker picks it up when the time comes. The draft lives on the
     * conversation, so the Scheduled folder is just a query.
     */
    async scheduleReply(id: string, input: ScheduleReplyInput) {
      const row = await requireConversation(id);
      const sendAt = new Date(input.sendAt);

      if (Number.isNaN(sendAt.getTime())) {
        throw badRequest("sendAt is not a valid timestamp");
      }

      await repository.updateConversation(id, {
        scheduledReplyAt: sendAt,
        scheduledReplyBody: JSON.stringify({
          bodyHtml: input.bodyHtml,
          bodyText: input.bodyText ?? null,
          subject: input.subject ?? replySubject(row.subject),
        }),
      });

      return { sendAt: sendAt.toISOString() };
    },

    /** Sets or clears a reminder. */
    async remind(id: string, input: RemindInput) {
      await requireConversation(id);

      if (input.remindAt === null) {
        await repository.updateConversation(id, { remindAt: null });
        return { remindAt: null };
      }

      const at = new Date(input.remindAt);
      if (Number.isNaN(at.getTime())) {
        throw badRequest("remindAt is not a valid timestamp");
      }

      await repository.updateConversation(id, { remindAt: at });
      return { remindAt: at.toISOString() };
    },

    /**
     * Links an unmatched conversation to a lead.
     *
     * A reply from a different address than we wrote to has no natural
     * owner. The operator attaches one, which also moves the conversation
     * into Primary and stops that lead's sequence.
     */
    async attachLead(id: string, input: AttachLeadInput) {
      const row = await requireConversation(id);
      const workspaceId = await ws();

      const lead = await repository.leadById(workspaceId, input.leadId);
      if (!lead) throw notFound("Lead");

      await repository.updateConversation(id, {
        leadId: lead.id,
        hasReply: 1,
      });

      // The contact address may not match the lead's; keep the lead's
      // address so the thread is findable by it.
      if (lead.email.toLowerCase() !== row.contactEmail.toLowerCase()) {
        await repository.updateConversation(id, { contactEmail: lead.email });
      }

      if (row.campaignId) {
        const enrollment = await repository.campaignLeadFor(
          lead.id,
          row.campaignId,
        );
        if (enrollment?.stopOnReply) {
          await repository.stopCampaignLead(enrollment.campaignLead.id, "replied");
        }
      }

      return { leadId: lead.id };
    },

    async getMessage(id: string) {
      const message = await repository.messageById(await ws(), id);
      if (!message) throw notFound("Message");
      return message;
    },

    async listOpportunities(query: ListOpportunitiesQuery) {
      const workspaceId = await ws();
      const [items, total] = await Promise.all([
        repository.listOpportunities(workspaceId, query),
        repository.countOpportunities(workspaceId, query),
      ]);
      return { items, total };
    },

    async updateOpportunity(id: string, input: UpdateOpportunityInput) {
      const existing = await repository.opportunityById(await ws(), id);
      if (!existing) throw notFound("Opportunity");
      return repository.updateOpportunity(id, input);
    },

    /** The lead's status history. */
    async leadTimeline(leadId: string) {
      return repository.leadStatusTimeline(await ws(), leadId);
    },

    async statusLabels() {
      return repository.leadStatusLabels(await ws());
    },

    /* ------------------------------ suggest ------------------------------ */

    /**
     * Writes a suggested reply.
     *
     * The model sees the whole thread — what we sent and what they wrote
     * back — so the suggestion answers the right question. It is a draft,
     * not a send: the operator reads it, changes it, and sends it.
     */
    async suggest(id: string, input: SuggestInput) {
      const workspaceId = await ws();
      const row = await requireConversation(id);
      const thread = await repository.messagesForConversation(id);

      if (thread.length === 0) {
        throw badRequest("There is nothing to reply to yet");
      }
      if (thread.every((m) => !(m.textBody ?? m.snippet ?? "").trim())) {
        throw badRequest("There is nothing to reply to yet: the thread has no readable text");
      }

      const lead = row.leadId
        ? await repository.leadById(workspaceId, row.leadId)
        : null;

      const campaign = row.campaignId
        ? await repository.campaignById(
            workspaceId,
            row.campaignId,
          )
        : null;

      const settings = await repository.workspaceSettings(workspaceId);
      const writerModel =
        settings?.llm?.writerModel ??
        (settings?.llm?.model && !isDecisionModel(settings.llm.model) ? settings.llm.model : null) ??
        "gpt-oss:20b";
      if (!writerModel) {
        throw badRequest("No drafting model is configured. Configure it in Settings -> AI.");
      }
      if (isDecisionModel(writerModel)) {
        throw badRequest(
          `"${writerModel}" is a decision model and cannot draft text. Choose a chat model in Settings -> AI.`,
        );
      }

      const maxTokens = settings?.llm?.writerMaxTokens ?? 1200;
      const timeoutMs = settings?.llm?.writerTimeoutMs ?? 45_000;

      const transcript = thread
        .map((m) => {
          const who = m.direction === "outbound" ? "Us" : m.fromAddress;
          return `${who}: ${(m.textBody ?? m.snippet ?? "").trim()}`;
        })
        .join("\n\n");

      const context = [
        `Campaign: ${campaign?.name ?? "none"}`,
        lead
          ? `Recipient: ${[lead.firstName, lead.lastName]
              .filter(Boolean)
              .join(" ")} <${lead.email}>${
              lead.company ? ` — ${lead.company}` : ""
            }${lead.title ? `, ${lead.title}` : ""}`
          : `Recipient: ${row.contactEmail}`,
        "",
        "Conversation so far:",
        transcript,
        input.instructions
          ? `\nThe operator added this instruction: ${input.instructions}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await chat({
        model: writerModel,
        messages: [
          { role: "system", content: SUGGEST_SYSTEM_PROMPT },
          {
            role: "user",
            content: `${context}\n\nWrite a reply in a ${input.tone} tone.`,
          },
        ],
        maxTokens,
        timeoutMs,
      });

      if (!result.ok) {
        throw badGateway(
          `No suggestion could be generated: ${
            result.error ?? "the model is unavailable"
          }`,
        );
      }
      if (!result.content || !result.content.trim()) {
        throw badGateway("The model returned no draft text. Try again or pick a different model.");
      }

      const draft = stripFence(result.content);
      if (!draft) {
        throw badGateway("The model returned no draft text. Try again or pick a different model.");
      }

      return {
        draft,
        model: result.model,
        latencyMs: result.latencyMs,
      };
    },

    /* ------------------------------- macros ------------------------------ */

    async listMacros() {
      return repository.listMacros(await ws());
    },

    async createMacro(input: CreateMacroInput) {
      return repository.createMacro({
        workspaceId: await ws(),
        name: input.name,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText ?? null,
      });
    },

    async updateMacro(id: MacroParams["id"], input: UpdateMacroInput) {
      const existing = await repository.macroById(await ws(), id);
      if (!existing) throw notFound("Macro");

      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.bodyHtml !== undefined) patch.bodyHtml = input.bodyHtml;
      if (input.bodyText !== undefined) patch.bodyText = input.bodyText;

      return repository.updateMacro(id, patch);
    },

    async removeMacro(id: MacroParams["id"]) {
      const existing = await repository.macroById(await ws(), id);
      if (!existing) throw notFound("Macro");
      await repository.removeMacro(id);
    },
  };
}

export type InboxService = ReturnType<typeof createInboxService>;
