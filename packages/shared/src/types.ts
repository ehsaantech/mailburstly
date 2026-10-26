import type {
  MailboxProvider,
  MailboxStatus,
  UserRole,
} from "./enums.js";

/** A sending-window rule. Times are "HH:MM" local to the rule's timezone. */
export interface ScheduleRule {
  /** 0 = Sunday. */
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  /**
   * IANA timezone, e.g. "America/New_York". Optional: a rule without one
   * uses the workspace's timezone.
   */
  timezone?: string;
}

export interface CampaignSchedule {
  mode: "always" | "office_hours" | "custom";
  rules: ScheduleRule[];
}

export interface CampaignSettings {
  stopOnReply: boolean;
  stopOnAutoReply: boolean;
  stopForCompany: boolean;
  openTracking: boolean;
  linkTracking: boolean;
  textOnly: boolean;
  insertUnsubscribeHeader: boolean;
  allowRiskyContacts: boolean;
  providerMatching: boolean;
  prioritizeNewLeads: boolean;
  enrollOnAdd: boolean;
}

export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  stopOnReply: true,
  stopOnAutoReply: false,
  stopForCompany: true,
  openTracking: true,
  linkTracking: true,
  textOnly: false,
  insertUnsubscribeHeader: true,
  allowRiskyContacts: false,
  providerMatching: false,
  prioritizeNewLeads: false,
  enrollOnAdd: true,
};

/**
 * The campaign funnel.
 *
 * Every number here has one definition, and the difference matters:
 *
 *   sent          — emails, not contacts. A lead emailed twice counts twice.
 *   contacted     — distinct leads we sent something to.
 *   replied       — distinct leads who wrote back, ignoring auto-replies.
 *   uniqueReplies — distinct leads who wrote back at all, auto-replies
 *                   included. The PRD's "unique replies".
 *   autoReplied   — distinct leads who only sent an autoresponder.
 *
 * A lead who auto-replied and later wrote back counts in both `replied` and
 * `autoReplied`, and once in `uniqueReplies`.
 */
export interface CampaignFunnel {
  /** Emails sent. */
  sent: number;
  /** Distinct leads contacted. */
  contacted: number;
  /** Distinct leads who opened. */
  opened: number;
  /** Distinct leads who clicked a link. */
  clicked: number;
  /** Distinct leads who replied, ignoring auto-replies. */
  replied: number;
  /** Distinct leads who only sent an autoresponder. */
  autoReplied: number;
  /** Distinct leads who wrote back at all. */
  uniqueReplies: number;
  /** Distinct leads whose current status is a positive one. */
  positiveReplies: number;
  /** Opportunities recorded. */
  opportunities: number;
  /** The summed value of those opportunities. */
  opportunityValue: number;
  /** Hard bounces. */
  bounced: number;
  /** Unsubscribes — the complaint rate's numerator. */
  unsubscribed: number;
}

/** An empty funnel, so a caller never has to null-check. */
export const EMPTY_FUNNEL: CampaignFunnel = {
  sent: 0,
  contacted: 0,
  opened: 0,
  clicked: 0,
  replied: 0,
  autoReplied: 0,
  uniqueReplies: 0,
  positiveReplies: 0,
  opportunities: 0,
  opportunityValue: 0,
  bounced: 0,
  unsubscribed: 0,
};

/** The rates the dashboard shows, derived from a funnel. */
export interface FunnelRates {
  openRate: number;
  clickRate: number;
  replyRate: number;
  positiveReplyRate: number;
  bounceRate: number;
  complaintRate: number;
}

export function funnelRates(funnel: CampaignFunnel): FunnelRates {
  const sent = funnel.sent;
  const pct = (n: number) => (sent > 0 ? n / sent : 0);

  return {
    openRate: pct(funnel.opened),
    clickRate: pct(funnel.clicked),
    replyRate: pct(funnel.replied),
    positiveReplyRate: pct(funnel.positiveReplies),
    bounceRate: pct(funnel.bounced),
    complaintRate: pct(funnel.unsubscribed),
  };
}

/** Why a campaign is not sending. */
export type DiagnoseReason =
  | "campaign_draft"
  | "paused"
  | "paused_by_rule"
  | "out_of_schedule"
  | "daily_limit_met"
  | "waiting_for_leads"
  | "no_accounts_assigned"
  | "all_accounts_unhealthy"
  | "sending";

export interface Diagnosis {
  reason: DiagnoseReason;
  /** A sentence the operator can act on. */
  message: string;
  /** What would have to change for the campaign to send. */
  remedy: string | null;
}

export interface WorkspaceSettings {
  /** Reply rate (%) at or above which reporting highlights a campaign. */
  replyRateThreshold: number;
  defaultMailboxDailyCap: number;
  defaultMinGapSeconds: number;
  defaultRandomJitterSeconds: number;
  /** How replies are classified. */
  llm: LlmSettings;
}

/**
 * Reply classification settings.
 *
 * The model and the threshold live here so an operator can change them from
 * the dashboard. The API key does not: it is a deployment secret, read from
 * the environment, and never written to the database.
 */
export interface LlmSettings {
  /**
   * The model that classifies replies.
   *
   * A decision model ("clef", "nimble", "tev") uses Ollama's /v1/systemone
   * endpoint, which returns a probability per label and a real confidence
   * score. Any other model uses /v1/chat/completions.
   */
  model: string;
  /**
   * Answers below this confidence are not acted on: no label is applied and
   * the reply is left in the inbox for a human.
   */
  minConfidence: number;
  /**
   * Whether replies are classified by a model at all. With this off, the
   * rule-based classifier answers every reply.
   */
  enabled: boolean;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  replyRateThreshold: 4,
  defaultMailboxDailyCap: 30,
  defaultMinGapSeconds: 540,
  defaultRandomJitterSeconds: 300,
  llm: {
    model: "clef:27b",
    minConfidence: 0.7,
    enabled: true,
  },
};

/* -------------------------------------------------------------------------- */
/* API shapes                                                                  */
/* -------------------------------------------------------------------------- */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  timezone: string;
}

export interface MailboxSummary {
  id: string;
  email: string;
  displayName: string | null;
  provider: MailboxProvider;
  status: MailboxStatus;
  dailyCap: number;
  healthScore: number;
  tags: string[];
  sentToday: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** Standard success envelope. Errors use `{ error: { code, message } }`. */
export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: {
    nextCursor: string | null;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}
