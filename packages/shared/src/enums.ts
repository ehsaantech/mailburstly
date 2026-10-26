/**
 * Enum-like unions mirroring the Postgres enums in @mailrung/db.
 * Kept as runtime objects so they double as validators, with derived types
 * so the compiler catches drift between the two packages.
 */

export const USER_ROLE = {
  ADMIN: "admin",
  MEMBER: "member",
} as const;
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const MAILBOX_PROVIDER = {
  GOOGLE: "google",
  MICROSOFT: "microsoft",
  IMAP_SMTP: "imap_smtp",
} as const;
export type MailboxProvider =
  (typeof MAILBOX_PROVIDER)[keyof typeof MAILBOX_PROVIDER];

export const MAILBOX_STATUS = {
  CONNECTED: "connected",
  DEGRADED: "degraded",
  FAILED: "failed",
  DISCONNECTED: "disconnected",
} as const;
export type MailboxStatus =
  (typeof MAILBOX_STATUS)[keyof typeof MAILBOX_STATUS];

export const CAMPAIGN_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
} as const;
export type CampaignStatus =
  (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS];

export const CAMPAIGN_STATE = {
  ACTIVE: "active",
  STOPPED: "stopped",
  COMPLETED: "completed",
  SUPPRESSED: "suppressed",
  PAUSED: "paused",
} as const;
export type CampaignState =
  (typeof CAMPAIGN_STATE)[keyof typeof CAMPAIGN_STATE];

export const LEAD_EMAIL_STATUS = {
  UNKNOWN: "unknown",
  VALID: "valid",
  INVALID: "invalid",
  RISKY: "risky",
  CATCH_ALL: "catch_all",
} as const;
export type LeadEmailStatus =
  (typeof LEAD_EMAIL_STATUS)[keyof typeof LEAD_EMAIL_STATUS];

export const INTEREST = {
  POSITIVE: "positive",
  NEUTRAL: "neutral",
  NEGATIVE: "negative",
} as const;
export type Interest = (typeof INTEREST)[keyof typeof INTEREST];

export const ACTIVITY_TYPE = {
  EMAIL_SENT: "email_sent",
  EMAIL_OPENED: "email_opened",
  LINK_CLICKED: "link_clicked",
  REPLY_RECEIVED: "reply_received",
  AUTO_REPLY: "auto_reply",
  BOUNCED: "bounced",
  UNSUBSCRIBED: "unsubscribed",
  STATUS_CHANGED: "status_changed",
  SUBSEQUENCE_ENTERED: "subsequence_entered",
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

export const SEND_JOB_STATE = {
  PENDING: "pending",
  CLAIMED: "claimed",
  SENT: "sent",
  SOFT_BOUNCED: "soft_bounced",
  HARD_BOUNCED: "hard_bounced",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;
export type SendJobState =
  (typeof SEND_JOB_STATE)[keyof typeof SEND_JOB_STATE];

export const BLOCKLIST_TYPE = {
  EMAIL: "email",
  DOMAIN: "domain",
} as const;
export type BlocklistType =
  (typeof BLOCKLIST_TYPE)[keyof typeof BLOCKLIST_TYPE];

export const BLOCKLIST_SOURCE = {
  MANUAL: "manual",
  HARD_BOUNCE: "hard_bounce",
  UNSUBSCRIBE: "unsubscribe",
  COMPLAINT: "complaint",
  AI_BLOCKLIST: "ai_blocklist",
} as const;
export type BlocklistSource =
  (typeof BLOCKLIST_SOURCE)[keyof typeof BLOCKLIST_SOURCE];

export const THREAD_MODE = {
  REPLY: "reply",
  NEW_THREAD: "new_thread",
} as const;
export type ThreadMode = (typeof THREAD_MODE)[keyof typeof THREAD_MODE];
