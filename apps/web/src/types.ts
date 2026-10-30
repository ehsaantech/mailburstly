/**
 * Domain types for the web app.
 *
 * These mirror `packages/shared` and will be imported from `@mailrung/shared`
 * once the api exists. Kept local for now so the frontend can run standalone.
 */

export type CampaignStatus = "draft" | "active" | "paused" | "completed";
export type MailboxStatus = "connected" | "degraded" | "failed" | "disconnected";
export type MailboxProvider = "google" | "microsoft" | "imap_smtp";
export type LeadEmailStatus =
  | "unknown"
  | "valid"
  | "invalid"
  | "risky"
  | "catch_all";
export type Interest = "positive" | "neutral" | "negative";
export type ActivityType =
  | "email_sent"
  | "email_opened"
  | "link_clicked"
  | "reply_received"
  | "auto_reply"
  | "bounced"
  | "unsubscribed"
  | "status_changed"
  | "subsequence_entered";
export type Folder =
  | "primary"
  | "unread"
  | "reminders"
  | "scheduled"
  | "sent"
  | "others";

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: string;
  launchedAt: string | null;
  dailyLimit: number | null;
  dailyMaxLeads: number | null;
  leadCount: number;
  contacted: number;
  progress: number;
  sent: number;
  opened: number;
  replied: number;
  positiveReplies: number;
  opportunities: number;
  opportunityValue: number;
  bounced: number;
  mailboxIds: string[];
  stepCount: number;
  pausedReason: string | null;
  tags: string[];
  emailGapMinutes?: number | null;
  randomWaitMax?: number | null;
  archivedAt?: string | null;
}

export interface CampaignStep {
  id: string;
  campaignId: string;
  position: number;
  subject: string | null;
  bodyHtml: string;
  preheader: string | null;
  delayMinutes: number;
  threadMode: "reply" | "new_thread";
  variants: StepVariant[];
  sent: number;
  opened: number;
  replied: number;
}

export interface StepVariant {
  id: string;
  label: string;
  subject: string;
  weight: number;
  sent: number;
  replied: number;
  pinned: boolean;
}

export interface Mailbox {
  id: string;
  email: string;
  displayName: string;
  provider: MailboxProvider;
  status: MailboxStatus;
  dailyCap: number;
  healthScore: number;
  sentToday: number;
  tags: string[];
  lastCheckedAt: string;
  lastError: string | null;
  warmupProgress: number | null;
}

export interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  statusId: number;
  emailStatus: LeadEmailStatus;
  ownerId: string | null;
  campaignId: string | null;
  listIds: string[];
  createdAt: string;
  lastActivityAt: string | null;
  customVariables: Record<string, string>;
}

export interface LeadLabel {
  id: number;
  name: string;
  description: string | null;
  interest: Interest;
  /** 0/1 in the API. */
  isBuiltin: number;
  useAi: number;
}

export interface LeadList {
  id: string;
  name: string;
  leadCount: number;
  createdAt: string;
  description: string | null;
}

export interface Conversation {
  id: string;
  leadId: string;
  leadEmail: string;
  leadName: string;
  company: string | null;
  campaignId: string;
  campaignName: string;
  mailboxId: string;
  mailboxEmail: string;
  subject: string;
  preview: string;
  folder: Folder;
  statusId: number;
  isRead: boolean;
  isStarred: boolean;
  lastMessageAt: string;
  messageCount: number;
  hasReminder: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  createdAt: string;
  isAutoReply: boolean;
  stepLabel: string | null;
}

export interface Activity {
  id: string;
  type: ActivityType;
  campaignId: string | null;
  campaignName: string | null;
  leadEmail: string | null;
  mailboxEmail: string | null;
  stepLabel: string | null;
  linkUrl: string | null;
  createdAt: string;
}

export interface Opportunity {
  id: string;
  leadId: string;
  leadEmail: string;
  company: string | null;
  campaignId: string;
  status: string;
  valueMinor: number;
  currency: string;
  createdAt: string;
}

export type DailyPoint = {
  date: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  [key: string]: string | number;
};

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  active: boolean;
}

export interface DashboardSummary {
  sentToday: number;
  repliesToday: number;
  opportunities: number;
  opportunityValue: number;
  activeCampaigns: number;
  connectedMailboxes: number;
  unhealthyMailboxes: number;
  bounceRate: number;
  replyRate: number;
  trend: DailyPoint[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
}
