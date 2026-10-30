import type { Logger } from "@/core/logger";
import { raiseAlert } from "@/lib/alerts";
import {
  buildSnippet,
  extractKeyword,
  extractResumeDate,
  isOutOfOffice,
  isUnsubscribeRequest,
} from "./classify";
import {
  classifyInterest as classifyInterestFallback,
  hasOpportunitySignal as hasOpportunityFallback,
} from "@/components/events/classify";
import type {
  ClassificationService,
  Interest,
} from "@/components/classification/service";
import { createEventsRepository, type EventsRepository } from "./repository";
import {
  WEBHOOK_EVENTS,
  type MailcoreBounceData,
  type MailcoreEvent,
  type MailcoreMessageData,
  type MailcoreTrackData,
} from "./types";

export interface EventsServiceDeps {
  db: { db: Parameters<typeof createEventsRepository>[0]["db"] };
  log: Logger;
  /**
   * Outbound webhook delivery. Optional so the events pipeline can run
   * without a webhook service wired in.
   */
  outbound?: {
    deliver(
      workspaceId: string,
      event: string,
      payload: Record<string, unknown>,
    ): Promise<void>;
  };
  /**
   * Subsequence enrolment. Optional: a reply only arms a follow-up
   * sequence when the workspace has configured one.
   */
  /**
   * The classifier. Optional: with no classifier the rules answer, and the
   * pipeline behaves exactly as it did before.
   */
  classifier?: ClassificationService;
  subsequences?: {
    enroll(input: {
      workspaceId: string;
      campaignId: string;
      campaignLeadId: string;
      leadId: string;
      trigger: "reply" | "reply_keyword" | "status_change" | "bounce" | "manual";
      keyword?: string | null;
    }): Promise<boolean>;
  };
}

/** Labels the classifier can assign, matched case-insensitively. */
const LABEL_FOR_INTEREST: Record<Interest, string> = {
  positive: "Interested",
  negative: "Not Interested",
  neutral: "",
  question: "",
};

export function createEventsService(deps: EventsServiceDeps) {
  const repo: EventsRepository = createEventsRepository({ db: deps.db.db });
  const { log } = deps;

  /**
   * Record an activity and, if the workspace has webhooks for it, deliver
   * the event to them.
   *
   * The activity is the source of truth; the webhook is a notification of
   * it. A webhook that fails must never fail the pipeline, so delivery
   * errors are swallowed here.
   */
  const recordActivity = async (entry: {
    workspaceId: string;
    campaignId: string | null;
    leadId: string | null;
    mailboxId: string | null;
    stepId: string | null;
    variantId: string | null;
    type:
      | "email_sent"
      | "email_opened"
      | "link_clicked"
      | "reply_received"
      | "auto_reply"
      | "bounced"
      | "unsubscribed"
      | "status_changed"
      | "subsequence_entered";
    meta?: Record<string, unknown>;
  }) => {
    await repo.recordActivity(entry);

    if (!deps.outbound) return;
    try {
      await deps.outbound.deliver(entry.workspaceId, entry.type, {
        ...entry,
        meta: entry.meta ?? {},
      });
    } catch (error) {
      log.warn("outbound webhook delivery failed", {
        type: entry.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /**
   * Classifies a reply, using the model when one is configured and the
   * rules when it is not.
   */
  const classifyReply = async (input: {
    subject: string | null;
    body: string;
    originalSubject?: string | null;
  }): Promise<{
    interest: Interest;
    confidence: number;
    isOpportunity: boolean;
    summary: string | null;
    source: "rules" | "llm";
    applicable: boolean;
  }> => {
    if (!deps.classifier) {
      const interest: Interest = classifyInterestFallback(
        input.subject,
        input.body,
      );
      return {
        interest,
        confidence: interest === "neutral" ? 0.4 : 0.85,
        isOpportunity:
          interest !== "neutral" &&
          hasOpportunityFallback(interest, input.subject, input.body),
        summary: null,
        source: "rules",
        applicable: true,
      };
    }

    return deps.classifier.classify(input);
  };

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */

  const handleMessageNew = async (event: MailcoreEvent) => {
    const data = (event.data ?? {}) as MailcoreMessageData;
    const account = event.account;
    if (!account) return;

    const workspaceId = await repo.workspaceId();
    if (!workspaceId) return;

    const mailbox = await repo.mailboxByMailcoreAccountId(account);
    if (!mailbox) {
      log.warn("webhook for unknown mailbox", { account });
      return;
    }

    const providerMessageId = data.id ?? null;
    if (providerMessageId) {
      const existing = await repo.messageByProviderId(providerMessageId);
      if (existing) return; // already stored
    }

    const fromAddress = data.from?.address?.toLowerCase() ?? "";
    const toAddress = (data.to ?? [])
      .map((t) => t.address?.toLowerCase() ?? "")
      .filter(Boolean)
      .join(", ");

    if (!fromAddress) return;

    const outbound = await repo.isOwnAddress(fromAddress);

    const subject = data.subject ?? null;
    const textBody = data.text?.plain ?? null;
    const htmlBody = data.text?.html ?? null;
    const body = textBody ?? htmlBody ?? "";
    const receivedAt = data.date ? new Date(data.date) : new Date();

    /* ------------------------- attribution ------------------------- */

    let leadId: string | null = null;
    let campaignId: string | null = null;
    let stepId: string | null = null;
    /** The subject of the email we sent, so the classifier sees both sides. */
    let originalSubject: string | null = null;

    if (!outbound) {
      // The best attribution is the message we replied to: it names the
      // lead, the campaign and the step exactly.
      const parentId = data.inReplyTo ?? data.relatedMessageId ?? null;
      if (parentId) {
        const sent = await repo.sentMessageById(parentId);
        if (sent) {
          leadId = sent.leadId;
          campaignId = sent.campaignId;
          stepId = sent.stepId;
          originalSubject = sent.subject;
        }
      }

      if (!leadId) {
        const lead = await repo.leadByEmail(workspaceId, fromAddress);
        if (lead) {
          leadId = lead.id;
          const cl = await repo.latestCampaignForLead(lead.id);
          campaignId = cl?.campaignId ?? null;
        }
      }
    } else {
      const lead = await repo.leadByEmail(workspaceId, toAddress);
      if (lead) {
        leadId = lead.id;
        const cl = await repo.latestCampaignForLead(lead.id);
        campaignId = cl?.campaignId ?? null;
      }
    }

    /* ----------------------- classification ----------------------- */

    const ooo = !outbound && isOutOfOffice(subject, body);
    const unsubscribe = !outbound && isUnsubscribeRequest(subject, body);
    const resumeAt = ooo ? extractResumeDate(subject, body, receivedAt) : null;

    // The classifier decides the interest. It short-circuits an
    // out-of-office or an unsubscribe without a model call, and falls back
    // to the rules when no model is configured or the call fails.
    const classification = await classifyReply({
      subject,
      body,
      originalSubject,
    });
    const interest = classification.interest;

    const messageClassification = outbound
      ? "other"
      : ooo
        ? "out_of_office"
        : unsubscribe
          ? "unsubscribe"
          : interest === "positive"
            ? "positive"
            : interest === "negative"
              ? "negative"
              : interest === "question"
                ? "question"
                : "other";

    /* ----------------------- conversation ------------------------- */

    const existingConversation = await repo.findConversation({
      workspaceId,
      mailboxId: mailbox.id,
      leadId,
      campaignId,
      contactEmail: fromAddress,
    });

    const conversation =
      existingConversation ??
      (await repo.createConversation({
        workspaceId,
        mailboxId: mailbox.id,
        leadId,
        campaignId,
        contactEmail: fromAddress,
        subject,
      }));

    const message = await repo.insertMessage({
      workspaceId,
      conversationId: conversation.id,
      mailboxId: mailbox.id,
      leadId,
      campaignId,
      providerMessageId,
      direction: outbound ? "outbound" : "inbound",
      fromAddress,
      toAddress: toAddress || mailbox.email,
      subject,
      textBody,
      htmlBody,
      snippet: buildSnippet(body),
      classification: messageClassification,
      isAutoReply: data.isAutoReply || ooo ? 1 : 0,
      isOutOfOffice: ooo ? 1 : 0,
      oooResumeAt: resumeAt,
      isUnsubscribe: unsubscribe ? 1 : 0,
      receivedAt,
    });

    await repo.touchConversation(conversation.id, {
      hasReply: outbound ? undefined : 1,
      status: "open",
    });

    if (outbound) return;

    /* --------------------------- actions -------------------------- */

    // The activity log is the campaign's event stream. An inbound message
    // that belongs to no lead and no campaign — a notification from
    // somewhere else entirely — is not a campaign event, and recording it
    // as a "reply" would make the reply rate a lie.
    if (leadId || campaignId) {
      await recordActivity({
        workspaceId,
        campaignId,
        leadId,
        mailboxId: mailbox.id,
        stepId,
        variantId: null,
        type: ooo ? "auto_reply" : "reply_received",
        meta: {
          subject,
          snippet: buildSnippet(body),
          classification,
          messageId: message.id,
        },
      });
    }

    if (!leadId) {
      log.info("inbound message with no matching lead", { fromAddress });
      return;
    }

    // Out of office: park the lead until they are back. This is a pause,
    // not a stop.
    if (ooo) {
      await repo.setLeadOooUntil(leadId, resumeAt);
      await applyLabel(workspaceId, leadId, "Out of Office", "auto_reply", {
        resumeAt: resumeAt?.toISOString() ?? null,
      });
      log.info("lead marked out of office", {
        leadId,
        resumeAt: resumeAt?.toISOString() ?? null,
      });
      return;
    }

    // Unsubscribe: stop everywhere and never contact them again.
    if (unsubscribe) {
      await repo.setLeadUnsubscribed(leadId);
      await repo.addToBlocklist(workspaceId, fromAddress, "unsubscribe");
      await repo.stopLeadEverywhere(leadId, "unsubscribed");
      await recordActivity({
        workspaceId,
        campaignId,
        leadId,
        mailboxId: mailbox.id,
        stepId,
        variantId: null,
        type: "unsubscribed",
        meta: { subject },
      });
      log.info("lead unsubscribed", { leadId });
      return;
    }

    // A label is only applied when the classifier says the answer is safe
    // to act on. Below the threshold the reply is left for a human.
    if (
      classification.applicable &&
      (interest === "positive" || interest === "negative")
    ) {
      await applyLabel(
        workspaceId,
        leadId,
        LABEL_FOR_INTEREST[interest],
        classification.source === "llm" ? "ai" : "reply",
        {
          interest,
          subject,
          confidence: classification.confidence,
          summary: classification.summary,
        },
      );
    }

    // A reply may arm a follow-up sequence.
    if (deps.subsequences && campaignId) {
      const campaignLead = await repo.campaignLeadForLead(leadId, campaignId);
      if (campaignLead) {
        const keyword = extractKeyword(subject, body);
        await deps.subsequences.enroll({
          workspaceId,
          campaignId,
          campaignLeadId: campaignLead.id,
          leadId,
          trigger: "reply",
        });
        if (keyword) {
          await deps.subsequences.enroll({
            workspaceId,
            campaignId,
            campaignLeadId: campaignLead.id,
            leadId,
            trigger: "reply_keyword",
            keyword,
          });
        }
      }
    }

    if (classification.applicable && classification.isOpportunity) {
      const existing = await repo.opportunityForConversation(conversation.id);
      if (!existing) {
        await repo.insertOpportunity({
          workspaceId,
          leadId,
          conversationId: conversation.id,
          campaignId,
          title: subject?.slice(0, 200) ?? "Opportunity",
          summary: buildSnippet(body, 500),
        });
        log.info("opportunity recorded", { leadId, campaignId });
      }
    }
  };

  /* ------------------------------------------------------------------ */

  /**
   * A send that did not go out.
   *
   * mailcore reports these as `messageFailed` and
   * `messageDeliveryError`. They used to be acknowledged and dropped, which
   * meant a mailbox whose credentials had expired sent nothing and said
   * nothing at all. Now they raise an alert: the operator's own address is
   * the one inbox that still works when the mail gateway does not.
   */
  const handleDeliveryFailure = async (event: MailcoreEvent) => {
    const data = (event.data ?? {}) as MailcoreBounceData;

    const reason =
      data.response?.message ??
      data.response?.status ??
      "The mail gateway could not deliver the message.";

    void raiseAlert({
      key: "worker.message_failed",
      title: "The mail gateway could not deliver a message",
      message: reason,
      severity: "error",
      service: "worker",
      context: {
        account: event.account ?? null,
        recipient: data.recipient ?? null,
        messageId: data.messageId ?? null,
        status: data.response?.status ?? null,
        event: event.event ?? null,
      },
    });
  };

  /* ------------------------------------------------------------------ */

  const handleBounce = async (event: MailcoreEvent) => {
    const data = (event.data ?? {}) as MailcoreBounceData;
    const account = event.account;
    if (!account) return;

    const workspaceId = await repo.workspaceId();
    if (!workspaceId) return;

    const mailbox = await repo.mailboxByMailcoreAccountId(account);
    const recipient = data.recipient?.toLowerCase() ?? "";

    const reason =
      data.response?.message ??
      data.response?.status ??
      "hard bounce";
    const code = data.response?.status ?? null;

    // Correlate back to what we sent. The Message-ID is the only join key
    // mailcore gives us.
    const sent = data.messageId
      ? await repo.sentMessageById(data.messageId)
      : null;

    const leadId = sent?.leadId ?? null;
    const campaignId = sent?.campaignId ?? null;

    if (!leadId && recipient) {
      const lead = await repo.leadByEmail(workspaceId, recipient);
      if (lead) {
        await recordBounceForLead(lead.id, recipient, reason, code, campaignId, mailbox?.id ?? null, sent?.stepId ?? null, sent?.variantId ?? null);
        log.info("hard bounce — lead blocked", { leadId: lead.id, recipient });
        return;
      }
    }

    if (leadId) {
      await recordBounceForLead(leadId, recipient, reason, code, campaignId, mailbox?.id ?? null, sent?.stepId ?? null, sent?.variantId ?? null);
      log.info("hard bounce — lead blocked", { leadId, recipient });
      return;
    }

    // A bounce we cannot attribute still must not be re-sent to.
    if (recipient) {
      await repo.addToBlocklist(workspaceId, recipient, "hard_bounce");
      log.warn("bounce for an unknown lead — address blocked anyway", {
        recipient,
      });
    }
  };

  const recordBounceForLead = async (
    leadId: string,
    recipient: string,
    reason: string,
    code: string | null,
    campaignId: string | null,
    mailboxId: string | null,
    stepId: string | null,
    variantId: string | null,
  ) => {
    const workspaceId = await repo.workspaceId();
    if (!workspaceId) return;

    await repo.insertBounce({
      leadId,
      campaignId,
      mailboxId,
      stepId,
      reason,
      code,
    });
    await repo.setLeadInvalid(leadId);
    if (recipient) {
      const lead = await repo.leadById(leadId);
      await repo.addToBlocklist(
        workspaceId,
        lead?.email ?? recipient,
        "hard_bounce",
      );
    }
    await repo.stopLeadEverywhere(leadId, "bounced");
    await recordActivity({
      workspaceId,
      campaignId,
      leadId,
      mailboxId,
      stepId,
      variantId,
      type: "bounced",
      meta: { recipient, reason, code },
    });
  };

  /* ------------------------------------------------------------------ */

  const handleComplaint = async (event: MailcoreEvent) => {
    const data = (event.data ?? {}) as MailcoreBounceData;
    const workspaceId = await repo.workspaceId();
    if (!workspaceId) return;

    const recipient = data.recipient?.toLowerCase() ?? "";
    if (!recipient) return;

    const lead = await repo.leadByEmail(workspaceId, recipient);
    if (!lead) {
      await repo.addToBlocklist(workspaceId, recipient, "complaint");
      return;
    }

    await repo.setLeadUnsubscribed(lead.id);
    await repo.addToBlocklist(workspaceId, recipient, "complaint");
    await repo.stopLeadEverywhere(lead.id, "unsubscribed");
    await recordActivity({
      workspaceId,
      campaignId: null,
      leadId: lead.id,
      mailboxId: null,
      stepId: null,
      variantId: null,
      type: "unsubscribed",
      meta: { reason: "complaint" },
    });
    log.info("complaint — lead unsubscribed and blocked", { leadId: lead.id });
  };

  /* ------------------------------------------------------------------ */

  const handleTracking = async (
    event: MailcoreEvent,
    eventName: string,
  ) => {
    const data = (event.data ?? {}) as MailcoreTrackData;
    const workspaceId = await repo.workspaceId();
    if (!workspaceId) return;

    const messageId = data.messageId ?? data.originalMessageId ?? null;
    if (!messageId) return;

    const sent = await repo.sentMessageById(messageId);
    if (!sent) return;

    await recordActivity({
      workspaceId,
      campaignId: sent.campaignId,
      leadId: sent.leadId,
      mailboxId: sent.mailboxId,
      stepId: sent.stepId,
      variantId: sent.variantId,
      type:
        eventName === WEBHOOK_EVENTS.trackOpen
          ? "email_opened"
          : "link_clicked",
      meta: { url: data.url ?? null, userAgent: data.userAgent ?? null },
    });
  };

  /* ------------------------------------------------------------------ */

  const handleListUnsubscribe = async (event: MailcoreEvent) => {
    const data = (event.data ?? {}) as { recipient?: string };
    const workspaceId = await repo.workspaceId();
    if (!workspaceId) return;

    const recipient = data.recipient?.toLowerCase() ?? "";
    if (!recipient) return;

    const lead = await repo.leadByEmail(workspaceId, recipient);
    if (!lead) {
      await repo.addToBlocklist(workspaceId, recipient, "unsubscribe");
      return;
    }

    await repo.setLeadUnsubscribed(lead.id);
    await repo.addToBlocklist(workspaceId, recipient, "unsubscribe");
    await repo.stopLeadEverywhere(lead.id, "unsubscribed");
  };

  /* ------------------------------------------------------------------ */

  /** Set the lead's status and record the change in the timeline. */
  const applyLabel = async (
    workspaceId: string,
    leadId: string,
    labelName: string,
    source: string,
    meta: Record<string, unknown>,
  ) => {
    if (!labelName) return;

    const label = await repo.labelByName(workspaceId, labelName);
    if (!label) return;

    const lead = await repo.leadById(leadId);
    if (!lead) return;

    if (lead.statusId === label.id) return; // no change, no event

    await repo.setLeadStatus(leadId, label.id);
    await repo.insertLeadStatusEvent({
      workspaceId,
      leadId,
      labelId: label.id,
      labelName: label.name,
      source,
      meta,
    });
    await recordActivity({
      workspaceId,
      campaignId: null,
      leadId,
      mailboxId: null,
      stepId: null,
      variantId: null,
      type: "status_changed",
      meta: { label: label.name, source, ...meta },
    });
  };

  /* ------------------------------------------------------------------ */
  /* Dispatch                                                            */
  /* ------------------------------------------------------------------ */

  return {
    /**
     * Handles one mailcore event.
     *
     * Every handler is idempotent: a redelivered event must not double-count
     * a reply or double-blocklist an address.
     */
    async handle(
      event: MailcoreEvent,
      eventId: string | null,
    ): Promise<void> {
      const name = event.event;
      if (!name) return;

      if (eventId) {
        if (await repo.isEventProcessed(eventId)) {
          log.debug("event already processed", { eventId, event: name });
          return;
        }
      }

      switch (name) {
        case WEBHOOK_EVENTS.messageNew:
          await handleMessageNew(event);
          break;
        case WEBHOOK_EVENTS.messageBounce:
          await handleBounce(event);
          break;
        case WEBHOOK_EVENTS.messageComplaint:
          await handleComplaint(event);
          break;
        case WEBHOOK_EVENTS.trackOpen:
        case WEBHOOK_EVENTS.trackClick:
          await handleTracking(event, name);
          break;
        case WEBHOOK_EVENTS.listUnsubscribe:
          await handleListUnsubscribe(event);
          break;
        case WEBHOOK_EVENTS.messageSent:
          // The dispatcher already recorded the send and its Message-ID, so
          // there is nothing to add here. Acknowledged so the queue drains.
          break;
        case WEBHOOK_EVENTS.messageFailed:
        case WEBHOOK_EVENTS.messageDeliveryError:
          // The gateway could not deliver. Worth an email.
          await handleDeliveryFailure(event);
          break;
        default:
          log.debug("ignoring webhook event", { event: name });
      }

      if (eventId) await repo.markEventProcessed(eventId, name);
    },
  };
}

export type EventsService = ReturnType<typeof createEventsService>;
