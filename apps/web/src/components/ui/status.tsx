import type { Campaign, Mailbox } from "@/types";
import { Badge, StatusDot } from "@/components/ui/Badge";
import type { LeadEmailStatus } from "@/types";

export function CampaignStatusBadge({ status }: { status: Campaign["status"] }) {
  switch (status) {
    case "active":
      return (
        <Badge tone="success" dot>
          Active
        </Badge>
      );
    case "paused":
      return (
        <Badge tone="warning" dot>
          Paused
        </Badge>
      );
    case "completed":
      return (
        <Badge tone="info" dot>
          Completed
        </Badge>
      );
    case "draft":
    default:
      return (
        <Badge tone="neutral" dot>
          Draft
        </Badge>
      );
  }
}

export function MailboxStatusBadge({ status }: { status: Mailbox["status"] }) {
  switch (status) {
    case "connected":
      return (
        <Badge tone="success" dot>
          Connected
        </Badge>
      );
    case "degraded":
      return (
        <Badge tone="warning" dot>
          Degraded
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="danger" dot>
          Failed
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral" dot>
          Disconnected
        </Badge>
      );
  }
}

export function EmailStatusBadge({ status }: { status: LeadEmailStatus }) {
  const map: Record<
    LeadEmailStatus,
    { tone: "success" | "danger" | "warning" | "info" | "neutral"; label: string }
  > = {
    valid: { tone: "success", label: "Valid" },
    invalid: { tone: "danger", label: "Invalid" },
    risky: { tone: "warning", label: "Risky" },
    catch_all: { tone: "info", label: "Catch-all" },
    unknown: { tone: "neutral", label: "Unknown" },
  };
  const config = map[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function HealthIndicator({ score }: { score: number }) {
  const tone =
    score >= 80 ? "success" : score >= 55 ? "warning" : "danger";
  const color =
    tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.max(2, score)}%` }}
        />
      </div>
      <span className="tabular text-xs font-medium text-fg-muted">
        {Math.round(score)}
      </span>
    </div>
  );
}

export function ProviderBadge({ provider }: { provider: Mailbox["provider"] }) {
  const label =
    provider === "google"
      ? "Google"
      : provider === "microsoft"
        ? "Microsoft"
        : "SMTP";
  return <Badge tone="outline">{label}</Badge>;
}

export const activityTone: Record<
  string,
  { tone: "accent" | "success" | "warning" | "danger" | "info" | "neutral"; label: string }
> = {
  email_sent: { tone: "neutral", label: "Sent" },
  email_opened: { tone: "info", label: "Opened" },
  link_clicked: { tone: "accent", label: "Clicked" },
  reply_received: { tone: "success", label: "Replied" },
  auto_reply: { tone: "warning", label: "Auto-reply" },
  bounced: { tone: "danger", label: "Bounced" },
  unsubscribed: { tone: "danger", label: "Unsubscribed" },
  status_changed: { tone: "info", label: "Status" },
  subsequence_entered: { tone: "accent", label: "Subsequence" },
};

export function ActivityBadge({ type }: { type: string }) {
  const config = activityTone[type] ?? { tone: "neutral" as const, label: type };
  return (
    <Badge tone={config.tone}>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot tone={config.tone} />
        {config.label}
      </span>
    </Badge>
  );
}
