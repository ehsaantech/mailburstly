import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Plus, Shield, Trash2, TrendingUp } from "lucide-react";

import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatTile } from "@/components/ui/Stat";
import { AreaChart } from "@/components/charts/AreaChart";
import { EmptyState } from "@/components/ui/Feedback";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui/Table";
import { ActivityBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Api shapes                                                                  */
/* -------------------------------------------------------------------------- */

interface Totals {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  leads: number;
  campaigns: number;
  openOpportunities: number;
}

interface SeriesPoint {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
}

interface LeaderboardRow {
  campaignId: string;
  name: string;
  status: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
}

interface TopReply {
  leadId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  replies: number;
}

/** The funnel, as the api reports it. */
interface Funnel {
  sent: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  autoReplied: number;
  uniqueReplies: number;
  positiveReplies: number;
  opportunities: number;
  opportunityValue: number;
  bounced: number;
  unsubscribed: number;
}

interface Overview {
  from: string;
  to: string;
  totals: Totals;
  funnel: Funnel;
  rates: {
    openRate: number;
    clickRate: number;
    replyRate: number;
    positiveReplyRate: number;
    bounceRate: number;
    complaintRate: number;
  };
  series: SeriesPoint[];
  leaderboard: LeaderboardRow[];
  topReplies: TopReply[];
}

interface MailboxMetric {
  mailboxId: string;
  email: string;
  status: string;
  healthScore: number;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  score: number;
}

interface ActivityRow {
  activity: {
    id: string;
    type: string;
    createdAt: string;
    campaignId: string | null;
    leadId: string | null;
    meta: Record<string, unknown>;
  };
  campaignName: string | null;
  leadEmail: string | null;
  mailboxEmail: string | null;
  stepSubject: string | null;
}

interface AutoPauseRule {
  id: string;
  campaignId: string | null;
  metric: string;
  threshold: number;
  direction: "above" | "below";
  action: "pause_campaign" | "pause_mailbox";
  enabled: number;
  lastFiredAt: string | null;
  createdAt: string;
}

interface AutoPauseEvent {
  id: string;
  ruleId: string;
  campaignId: string | null;
  metricValue: number;
  actionTaken: string;
  firedAt: string;
}

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
] as const;

const METRIC_LABELS: Record<string, string> = {
  bounce_rate: "Bounce rate",
  reply_rate: "Reply rate",
  open_rate: "Open rate",
  spam_rate: "Unsubscribe rate",
  mailbox_health: "Mailbox health",
};

const ACTIVITY_TYPES = [
  "email_sent",
  "email_opened",
  "link_clicked",
  "reply_received",
  "auto_reply",
  "bounced",
  "unsubscribed",
  "status_changed",
  "subsequence_entered",
] as const;

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function AnalyticsPage() {
  const [range, setRange] = useState<string>("30");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [includeAutoReplies, setIncludeAutoReplies] = useState(false);
  const queryClient = useQueryClient();

  const window_ = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    const to = new Date();
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - days);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  }, [range]);

  const overview = useQuery({
    queryKey: ["analytics", "overview", range],
    queryFn: () =>
      api.get<{ data: Overview }>("/analytics/overview", { query: window_ }),
  });

  const mailboxes = useQuery({
    queryKey: ["analytics", "mailboxes", range],
    queryFn: () =>
      api.get<{ data: { items: MailboxMetric[] } }>("/analytics/mailboxes", {
        query: window_,
      }),
  });

  const data = overview.data?.data;
  const totals = data?.totals;
  const series = data?.series ?? [];
  const funnel = data?.funnel;

  const openRate =
    totals && totals.sent > 0 ? (totals.opened / totals.sent) * 100 : 0;
  const bounceRate =
    totals && totals.sent > 0 ? (totals.bounced / totals.sent) * 100 : 0;

  // Auto-replies are excluded by default: an out-of-office is not a
  // conversation, and counting it inflates the reply rate. The toggle
  // shows the other number for the operator who wants it.
  const replies = includeAutoReplies
    ? (funnel?.uniqueReplies ?? 0)
    : (funnel?.replied ?? 0);
  const replyRate =
    funnel && funnel.sent > 0 ? (replies / funnel.sent) * 100 : 0;
  const positiveReplyRate =
    funnel && funnel.sent > 0
      ? ((funnel?.positiveReplies ?? 0) / funnel.sent) * 100
      : 0;
  const complaintRate =
    funnel && funnel.sent > 0
      ? ((funnel?.unsubscribed ?? 0) / funnel.sent) * 100
      : 0;

  /** Downloads the export. The browser handles the file. */
  const download = (dataset: "activity" | "daily") => {
    const params = new URLSearchParams({ dataset, ...window_ });
    const url = `${import.meta.env.VITE_API_URL ?? "/api"}/analytics/export?${params.toString()}`;
    // A plain link download keeps the auth cookie and lands the file
    // straight in the downloads folder.
    const link = document.createElement("a");
    link.href = url;
    link.download = `mailrung-${dataset}-${window_.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <Page
      title="Analytics"
      description="What is working, at the campaign, step and mailbox level."
      actions={
        <>
          <Select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="h-8 w-36 text-xs"
            aria-label="Date range"
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => download("activity")}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {overview.isLoading ? (
          <p className="text-xs text-fg-subtle">Loading…</p>
        ) : !totals || totals.sent === 0 ? (
          <EmptyState
            icon={<TrendingUp className="h-5 w-5" />}
            title="No activity in this period"
            description="Send a campaign and the numbers will show up here."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => download("activity")}
              >
                <Download className="h-3.5 w-3.5" />
                Export what there is
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Total sent"
                value={formatNumber(totals.sent)}
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <StatTile label="Open rate" value={formatPercent(openRate)} />
              <StatTile
                label="Reply rate"
                value={formatPercent(replyRate)}
                deltaLabel={
                  includeAutoReplies
                    ? "including auto-replies"
                    : "auto-replies excluded"
                }
              />
              <StatTile label="Bounce rate" value={formatPercent(bounceRate, 2)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Unique replies"
                value={formatNumber(funnel?.uniqueReplies ?? 0)}
                deltaLabel="each lead counted once"
              />
              <StatTile
                label="Positive reply rate"
                value={formatPercent(positiveReplyRate)}
                deltaLabel={`${formatNumber(funnel?.positiveReplies ?? 0)} positive`}
              />
              <StatTile
                label="Opportunity value"
                value={formatCurrency(funnel?.opportunityValue ?? 0)}
                deltaLabel={`${formatNumber(funnel?.opportunities ?? 0)} opportunities`}
              />
              <StatTile
                label="Complaint rate"
                value={formatPercent(complaintRate, 2)}
                deltaLabel={`${formatNumber(funnel?.unsubscribed ?? 0)} unsubscribed`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-fg-muted">
                <input
                  type="checkbox"
                  checked={includeAutoReplies}
                  onChange={(e) => setIncludeAutoReplies(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-[var(--accent)]"
                />
                Count auto-replies as replies
              </label>
              <span className="text-[10px] text-fg-subtle">
                {formatNumber(funnel?.autoReplied ?? 0)} auto-replies in this
                period. Reporting is in UTC; the workspace timezone applies to
                the daily limits.
              </span>
            </div>

            <Card>
              <CardHeader
                title="Volume and engagement"
                description="Sent, opened and replied across the selected period"
                actions={
                  <Badge tone="accent">
                    {formatNumber(totals.openOpportunities)} open opportunities
                  </Badge>
                }
              />
              <CardBody>
                <AreaChart
                  data={series.map((p) => ({
                    date: p.date,
                    sent: p.sent,
                    opened: p.opened,
                    replied: p.replied,
                  }))}
                  series={[
                    {
                      key: "sent",
                      label: "Sent",
                      color: "var(--accent)",
                      fill: true,
                    },
                    {
                      key: "opened",
                      label: "Opened",
                      color: "var(--info)",
                      fill: true,
                    },
                    {
                      key: "replied",
                      label: "Replied",
                      color: "var(--success)",
                      fill: true,
                      axis: "right",
                    },
                  ]}
                  height={260}
                  formatValue={(v) => formatCompact(v)}
                />
              </CardBody>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader
                  title="Campaign performance"
                  description="Sorted by reply rate"
                />
                <Table>
                  <THead>
                    <tr>
                      <TH>Campaign</TH>
                      <TH align="right">Sent</TH>
                      <TH align="right">Opened</TH>
                      <TH align="right">Reply</TH>
                      <TH align="right">Bounce</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {(data?.leaderboard ?? [])
                      .filter((c) => c.sent > 0)
                      .map((c) => {
                        const rate =
                          c.sent > 0 ? (c.replied / c.sent) * 100 : 0;
                        const bounce =
                          c.sent > 0 ? (c.bounced / c.sent) * 100 : 0;
                        return (
                          <TR key={c.campaignId}>
                            <TD>
                              <Link
                                to={`/campaigns/${c.campaignId}`}
                                className="line-clamp-1 max-w-[200px] text-sm text-fg hover:underline"
                              >
                                {c.name}
                              </Link>
                            </TD>
                            <TD align="right" className="tabular text-fg-muted">
                              {formatNumber(c.sent)}
                            </TD>
                            <TD align="right" className="tabular text-fg-muted">
                              {formatNumber(c.opened)}
                            </TD>
                            <TD align="right">
                              <span
                                className={cn(
                                  "tabular",
                                  rate >= 5
                                    ? "text-success"
                                    : rate >= 1
                                      ? "text-fg"
                                      : "text-fg-muted",
                                )}
                              >
                                {formatPercent(rate)}
                              </span>
                            </TD>
                            <TD align="right">
                              <span
                                className={cn(
                                  "tabular text-xs",
                                  bounce > 3
                                    ? "text-danger"
                                    : "text-fg-muted",
                                )}
                              >
                                {formatPercent(bounce, 1)}
                              </span>
                            </TD>
                          </TR>
                        );
                      })}
                  </TBody>
                </Table>
              </Card>

              <Card>
                <CardHeader
                  title="Who replied"
                  description="The people who actually answered"
                />
                <Table>
                  <THead>
                    <tr>
                      <TH>Lead</TH>
                      <TH>Company</TH>
                      <TH align="right">Replies</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {(data?.topReplies ?? []).map((r) => (
                      <TR key={r.leadId}>
                        <TD>
                          <span className="truncate text-xs text-fg">
                            {[r.firstName, r.lastName]
                              .filter(Boolean)
                              .join(" ") || r.email}
                          </span>
                        </TD>
                        <TD>
                          <span className="truncate text-xs text-fg-muted">
                            {r.company ?? "—"}
                          </span>
                        </TD>
                        <TD align="right" className="tabular text-fg-muted">
                          {formatNumber(r.replies)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            </div>

            <MailboxCard
              items={mailboxes.data?.data?.items ?? []}
              isLoading={mailboxes.isLoading}
            />
          </>
        )}

        {/* The rules sit outside the "no activity" branch on purpose: a rule
            is set up before there is anything to measure. */}
        <div className="mt-4">
          <AutoPauseCard onAdd={() => setRuleOpen(true)} />
        </div>

        <ActivityCard window={window_} />
      </div>

      <AutoPauseRuleModal
        open={ruleOpen}
        onClose={() => setRuleOpen(false)}
        onSaved={() => {
          setRuleOpen(false);
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
        }}
      />
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Mailbox performance                                                         */
/* -------------------------------------------------------------------------- */

function MailboxCard({
  items,
  isLoading,
}: {
  items: MailboxMetric[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <p className="text-xs text-fg-subtle">Loading…</p>
        </CardBody>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Mailbox performance"
          description="Where the deliverability risk is"
        />
        <CardBody>
          <p className="text-xs text-fg-subtle">No mailboxes yet.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Mailbox performance"
        description="Where the deliverability risk is. The score blends health with the engagement the mailbox produced."
      />
      <Table>
        <THead>
          <tr>
            <TH>Mailbox</TH>
            <TH align="right">Sent</TH>
            <TH align="right">Opened</TH>
            <TH align="right">Replied</TH>
            <TH align="right">Bounce</TH>
            <TH align="right">Score</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((m) => {
            const bounce = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
            return (
              <TR key={m.mailboxId}>
                <TD>
                  <span className="truncate text-xs text-fg">{m.email}</span>
                </TD>
                <TD align="right" className="tabular text-fg-muted">
                  {formatNumber(m.sent)}
                </TD>
                <TD align="right" className="tabular text-fg-muted">
                  {formatNumber(m.opened)}
                </TD>
                <TD align="right" className="tabular text-fg-muted">
                  {formatNumber(m.replied)}
                </TD>
                <TD align="right">
                  <span
                    className={cn(
                      "tabular text-xs",
                      bounce > 3 ? "text-danger" : "text-fg-muted",
                    )}
                  >
                    {formatPercent(bounce, 1)}
                  </span>
                </TD>
                <TD align="right">
                  <span
                    className={cn(
                      "tabular text-xs font-medium",
                      m.score >= 80
                        ? "text-success"
                        : m.score >= 55
                          ? "text-warning"
                          : "text-danger",
                    )}
                  >
                    {m.score}
                  </span>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity log                                                                */
/* -------------------------------------------------------------------------- */

function ActivityCard({
  window: win,
}: {
  window: { from: string; to: string };
}) {
  const [type, setType] = useState<string>("");

  const activity = useQuery({
    queryKey: ["analytics", "activity", type, win.from, win.to],
    queryFn: () =>
      api.get<{ data: { items: ActivityRow[]; total: number } }>(
        "/analytics/activity",
        { query: { ...win, type: type || undefined, limit: 100 } },
      ),
  });

  const items = activity.data?.data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Activity log"
        description="Every event, newest first. Reporting is in UTC."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-8 w-40 text-xs"
              aria-label="Event type"
            >
              <option value="">All events</option>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const params = new URLSearchParams({
                  dataset: "activity",
                  ...win,
                  type: type || undefined,
                } as Record<string, string>);
                const url = `${import.meta.env.VITE_API_URL ?? "/api"}/analytics/export?${params.toString()}`;
                const link = document.createElement("a");
                link.href = url;
                link.download = `mailrung-activity-${win.to}.csv`;
                document.body.appendChild(link);
                link.click();
                link.remove();
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        }
      />
      <div className="max-h-[420px] overflow-y-auto">
        {items.length === 0 ? (
          <CardBody>
            <p className="text-xs text-fg-subtle">
              No events in this period.
            </p>
          </CardBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Event</TH>
                <TH>Lead</TH>
                <TH>Campaign</TH>
                <TH>Mailbox</TH>
                <TH>Step</TH>
                <TH align="right">When</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((row) => (
                <TR key={row.activity.id}>
                  <TD>
                    <ActivityBadge type={row.activity.type} />
                  </TD>
                  <TD>
                    <span className="truncate text-xs text-fg">
                      {row.leadEmail ?? "—"}
                    </span>
                  </TD>
                  <TD>
                    <span className="line-clamp-1 max-w-[180px] text-xs text-fg-muted">
                      {row.campaignName ?? "—"}
                    </span>
                  </TD>
                  <TD>
                    <span className="text-xs text-fg-subtle">
                      {row.mailboxEmail ?? "—"}
                    </span>
                  </TD>
                  <TD>
                    <span className="line-clamp-1 max-w-[180px] text-xs text-fg-subtle">
                      {row.stepSubject ?? "—"}
                    </span>
                  </TD>
                  <TD align="right">
                    <span className="text-xs text-fg-subtle">
                      {formatRelative(row.activity.createdAt)}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Auto-pause rules                                                            */
/* -------------------------------------------------------------------------- */

function AutoPauseCard({ onAdd }: { onAdd: () => void }) {
  const queryClient = useQueryClient();

  const rules = useQuery({
    queryKey: ["analytics", "auto-pause-rules"],
    queryFn: () =>
      api.get<{ data: { items: AutoPauseRule[] } }>("/analytics/auto-pause-rules"),
  });

  const history = useQuery({
    queryKey: ["analytics", "auto-pause-history"],
    queryFn: () =>
      api.get<{ data: { items: AutoPauseEvent[] } }>(
        "/analytics/auto-pause-rules/history",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/analytics/auto-pause-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (rule: AutoPauseRule) =>
      api.patch(`/analytics/auto-pause-rules/${rule.id}`, {
        enabled: rule.enabled !== 1,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  const items = rules.data?.data?.items ?? [];
  const events = history.data?.data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Auto-pause rules"
        description="Pause a campaign when its metrics go bad. A paused campaign is not evaluated again until it is resumed."
        actions={
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {items.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/50 p-3">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            <p className="text-[11px] leading-snug text-fg-muted">
              No rules yet. A bounce rate above 5% is the one worth having
              first — it is the metric that precedes a blocked domain.
            </p>
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Metric</TH>
                <TH>Condition</TH>
                <TH>Action</TH>
                <TH>Scope</TH>
                <TH align="right">Last fired</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {items.map((rule) => (
                <TR key={rule.id}>
                  <TD>
                    <span className="text-xs text-fg">
                      {METRIC_LABELS[rule.metric] ?? rule.metric}
                    </span>
                  </TD>
                  <TD>
                    <span className="tabular text-xs text-fg-muted">
                      {rule.direction === "below" ? "below" : "above"}{" "}
                      {rule.threshold}
                      {rule.metric === "mailbox_health" ? "" : "%"}
                    </span>
                  </TD>
                  <TD>
                    <span className="text-xs text-fg-muted">
                      {rule.action === "pause_mailbox"
                        ? "Pause mailbox"
                        : "Pause campaign"}
                    </span>
                  </TD>
                  <TD>
                    <span className="text-xs text-fg-subtle">
                      {rule.campaignId ? "One campaign" : "All campaigns"}
                    </span>
                  </TD>
                  <TD align="right">
                    <span className="text-xs text-fg-subtle">
                      {rule.lastFiredAt
                        ? formatRelative(rule.lastFiredAt)
                        : "never"}
                    </span>
                  </TD>
                  <TD align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggle.mutate(rule)}
                      >
                        {rule.enabled === 1 ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete rule"
                        onClick={() => remove.mutate(rule.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {events.length > 0 ? (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Recent pauses
            </p>
            <div className="space-y-1">
              {events.slice(0, 5).map((e) => (
                <p key={e.id} className="text-[11px] text-fg-muted">
                  {formatRelative(e.firedAt)} — metric reached{" "}
                  {Number(e.metricValue.toFixed(2))},{" "}
                  {e.actionTaken === "pause_mailbox"
                    ? "the mailbox was paused"
                    : "the campaign was paused"}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function AutoPauseRuleModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [metric, setMetric] = useState("bounce_rate");
  const [threshold, setThreshold] = useState("5");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [action, setAction] = useState<"pause_campaign" | "pause_mailbox">(
    "pause_campaign",
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post("/analytics/auto-pause-rules", {
        metric,
        threshold: Number(threshold),
        direction,
        action,
        enabled: true,
      }),
    onSuccess: onSaved,
    onError: (e) =>
      setError(
        e instanceof Error ? e.message : "The rule could not be saved",
      ),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New auto-pause rule"
      description="The rule is evaluated on every scheduler tick."
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            Create rule
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Metric" htmlFor="rule-metric">
          <Select
            id="rule-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            {Object.entries(METRIC_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Direction" htmlFor="rule-direction">
            <Select
              id="rule-direction"
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as "above" | "below")
              }
            >
              <option value="above">rises above</option>
              <option value="below">falls below</option>
            </Select>
          </Field>
          <Field
            label={metric === "mailbox_health" ? "Score" : "Percent"}
            htmlFor="rule-threshold"
          >
            <Input
              id="rule-threshold"
              type="number"
              min={0}
              step="0.1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Action" htmlFor="rule-action">
          <Select
            id="rule-action"
            value={action}
            onChange={(e) =>
              setAction(
                e.target.value as "pause_campaign" | "pause_mailbox",
              )
            }
          >
            <option value="pause_campaign">Pause the campaign</option>
            <option value="pause_mailbox">Pause the mailbox</option>
          </Select>
        </Field>

        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
