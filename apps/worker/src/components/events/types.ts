/**
 * EmailEngine webhook payload shapes.
 *
 * These mirror the events we consume. Every field is optional: EmailEngine
 * omits whatever the provider did not supply, and a handler that assumes a
 * field exists will crash on a perfectly valid payload.
 *
 * @see https://learn.emailengine.app/docs/reference/webhook-events
 */

export interface EmailEngineAddress {
  name?: string;
  address?: string;
}

export interface EmailEngineText {
  id?: string;
  plain?: string;
  html?: string;
  hasMore?: boolean;
}

export interface EmailEngineMessageData {
  /** EmailEngine's own id for the message. */
  id?: string;
  /** Globally unique provider id (Gmail message id, IMAP EMAILID). */
  emailId?: string;
  threadId?: string;
  date?: string;
  subject?: string;
  from?: EmailEngineAddress;
  to?: EmailEngineAddress[];
  cc?: EmailEngineAddress[];
  replyTo?: EmailEngineAddress[];
  messageId?: string;
  inReplyTo?: string;
  text?: EmailEngineText;
  preview?: string;
  /** True when the subject or headers say it is an automatic reply. */
  isAutoReply?: boolean;
  /** True when the message is a bounce notification. */
  isBounce?: boolean;
  /** True when the message is an abuse report. */
  isComplaint?: boolean;
  /** Message-ID of the message this one refers to. */
  relatedMessageId?: string;
  /** False when the message was moved rather than newly received. */
  seemsLikeNew?: boolean;
  /** Folder role: "\Inbox", "\Sent", "\Junk"… */
  messageSpecialUse?: string;
  path?: string;
  headers?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface EmailEngineBounceData {
  /** EmailEngine id of the bounce notification message. */
  bounceMessage?: string;
  /** The address that bounced. */
  recipient?: string;
  /** "failed" for a hard bounce. */
  action?: string;
  response?: {
    source?: string;
    message?: string;
    status?: string;
    category?: string;
    recommendedAction?: string;
    blocklist?: { name?: string; type?: string; host?: boolean };
    retryAfter?: number;
  };
  mta?: string;
  queueId?: string;
  /** Message-ID of the original message that bounced. */
  messageId?: string;
  originalMessageId?: string;
  messageHeaders?: Record<string, string[]> | null;
}

export interface EmailEngineSentData {
  messageId?: string;
  originalMessageId?: string;
  response?: string;
  queueId?: string;
  envelope?: { from?: string; to?: string[] };
}

export interface EmailEngineTrackData {
  messageId?: string;
  originalMessageId?: string;
  /** "open" or "click". */
  type?: string;
  url?: string;
  userAgent?: string;
  ip?: string;
  date?: string;
}

/** The envelope every EmailEngine webhook shares. */
export interface EmailEngineEvent<T = unknown> {
  serviceUrl?: string | null;
  /** The account (mailbox) the event came from. */
  account?: string;
  date?: string;
  event?: string;
  path?: string;
  specialUse?: string;
  data?: T;
}

/** Event names we handle. Everything else is acknowledged and ignored. */
export const WEBHOOK_EVENTS = {
  messageNew: "messageNew",
  messageSent: "messageSent",
  messageBounce: "messageBounce",
  messageComplaint: "messageComplaint",
  messageDeliveryError: "messageDeliveryError",
  messageFailed: "messageFailed",
  trackOpen: "trackOpen",
  trackClick: "trackClick",
  listUnsubscribe: "listUnsubscribe",
} as const;

export type WebhookEventName =
  (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];
