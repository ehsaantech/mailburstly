import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  Mail,
  Send,
  Target,
  Wallet,
} from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { AreaChart } from "@/components/charts/AreaChart";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatTile, ProgressBar } from "@/components/ui/Stat";
import { ActivityBadge, CampaignStatusBadge } from "@/components/ui/status";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/format";
import type { Campaign } from "@/types";

/* -------------------------------------------------------------------------- */
/* Api shapes                                                                  */
/* -------------------------------------------------------------------------- */

interface Today {
  sent: number;
  opened: number;
  replied: number;
  uniqueReplies: number;
  opportunities: number;
  opportunityValue: number;
  replyRate: number;
  bounceRate: number;
}

interface SeriesPoint {
  date: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
}

interface Overview {
  from: string;
  to: string;
  today: Today;
  series: SeriesPoint[];
  leaderboard: Array<{
    campaignId: string;
    name: string;
    status: string;
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
  }>;
}

interface ActivityRow {
  activity: {
    id: string;
    type: string;
    createdAt: string;
  };
  campaignName: string | null;
  leadEmail: string | null;
  mailboxEmail: string | null;
}

interface Opportunity {
  id: string;
  title: string;
  summary: string | null;
  status: "open" | "won" | "lost";
  value: number | null;
  createdAt: string;
  leadEmail: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadCompany: string | null;
}

interface MailboxSummary {
  id: string;
  email: string;
  status: string;
  healthScore: number;
  lastError: string | null;
  sentToday: number;
  dailyCap: number;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function DashboardPage() {
  const { data: campaignsData } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<{ data: { items: Campaign[] } }>("/campaigns"),
  });

  const { data: overviewData } = useQuery({
    queryKey: ["analytics", "overview", "dashboard"],
    queryFn: () => api.get<{ data: Overview }>("/analytics/overview"),
  });

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () =>
      api.get<{ data: { items: MailboxSummary[] } }>("/mailboxes"),
  });

  const { data: activityData } = useQuery({
    queryKey: ["analytics", "activity", "dashboard"],
    queryFn: () =>
      api.get<{ data: { items: ActivityRow[] } }>("/analytics/activity", {
        query: { limit: 12 },
      }),
  });

  const { data: opportunitiesData } = useQuery({
    queryKey: ["inbox", "opportunities"],
    queryFn: () =>
      api.get<{ data: { items: Opportunity[] } }>("/inbox/opportunities", {
        query: { limit: 5, status: "open" },
      }),
  });

  const campaigns = campaignsData?.data?.items ?? [];
  const active = campaigns.filter((c) => c.status === "active");
  const paused = campaigns.filter((c) => c.status === "paused");
  const mailboxList = mailboxesData?.data?.items ?? [];
  const unhealthy = mailboxList.filter(
    (m) => m.status === "degraded" || m.status === "failed",
  );
  const recent = activityData?.data?.items ?? [];
  const opportunityList = opportunitiesData?.data?.items ?? [];

  const today = overviewData?.data?.today;
  const series = overviewData?.data?.series ?? [];
  const leaderboard = overviewData?.data?.leaderboard ?? [];

  const pipeline = opportunityList.reduce((sum, o) => sum + (o.value ?? 0), 0);

  return (
    <Page
      title="Dashboard"
      description="Live outreach health across every client and campaign."
      actions={
        <>
          <Button variant="secondary" size="sm">
            Last 30 days
          </Button>
          <Link to="/campaigns">
            <Button variant="primary" size="sm">
              <Send className="h-3.5 w-3.5" />
              New campaign
            </Button>
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        {/* KPI row */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Sent today"
            value={formatNumber(today?.sent ?? 0)}
            icon={<Send className="h-4 w-4" />}
          />
          <StatTile
            label="Replies today"
            value={formatNumber(today?.replied ?? 0)}
            hint={
              today
                ? `${formatNumber(today.uniqueReplies)} unique · ${formatPercent(today.replyRate)} of sends`
                : undefined
            }
            icon={<Inbox className="h-4 w-4" />}
          />
          <StatTile
            label="Opportunities"
            value={formatNumber(today?.opportunities ?? 0)}
            hint={
              today
                ? `${formatPercent(today.bounceRate, 2)} bounce`
                : undefined
            }
            icon={<Target className="h-4 w-4" />}
          />
          <StatTile
            label="Pipeline value"
            value={formatCurrency(today?.opportunityValue ?? 0)}
            hint="Open opportunities from replies"
            icon={<Wallet className="h-4 w-4" />}
          />
        </div>

        {/* Trend + attention */}
        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <Card>
            <CardHeader
              title="Sending volume"
              description="Sent, opened and replied over the last 30 days"
            />
            <CardBody>
              {series.length === 0 ? (
                <p className="py-12 text-center text-sm text-fg-muted">
                  No activity in this period.
                </p>
              ) : (
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
                  height={240}
                  formatValue={(v) => formatCompact(v)}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Needs attention"
              description={`${unhealthy.length + paused.length} items`}
            />
            <CardBody className="space-y-3 p-0">
              {paused.map((c) => (
                <AttentionRow
                  key={c.id}
                  icon={<AlertTriangle className="h-4 w-4 text-warning" />}
                  title={c.name}
                  detail={c.pausedReason ?? "Campaign paused by rule"}
                  action={{ label: "Review", to: `/campaigns/${c.id}` }}
                />
              ))}
              {unhealthy.map((m) => (
                <AttentionRow
                  key={m.id}
                  icon={<Mail className="h-4 w-4 text-danger" />}
                  title={m.email}
                  detail={m.lastError ?? "Mailbox unhealthy"}
                  action={{ label: "Fix", to: "/mailboxes" }}
                />
              ))}
              {unhealthy.length + paused.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-fg-muted">
                  Nothing needs attention.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>

        {/* Campaigns + activity */}
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader
              title="Active campaigns"
              description="What is running right now"
              actions={
                <Link
                  to="/campaigns"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                >
                  All campaigns
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            />
            <CardBody className="space-y-3 p-0">
              {active.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-fg-muted">
                  No campaigns are running.
                </p>
              ) : (
                active.map((c) => (
                  <Link
                    key={c.id}
                    to={`/campaigns/${c.id}`}
                    className="block border-b border-border px-4 py-3 last:border-b-0 transition-colors hover:bg-surface-muted/50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">
                          {c.name}
                        </span>
                        <CampaignStatusBadge status={c.status} />
                      </div>
                      <span className="tabular shrink-0 text-[11px] text-fg-subtle">
                        {formatNumber(c.sent)} sent ·{" "}
                        {formatPercent(
                          c.sent ? (c.replied / c.sent) * 100 : 0,
                        )}{" "}
                        replied
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <ProgressBar
                        value={c.progress}
                        className="h-1 flex-1"
                      />
                      <span className="tabular text-[10px] text-fg-subtle">
                        {c.leadCount} leads
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent activity"
              description="The last few things that happened"
            />
            <CardBody className="p-0">
              <div className="divide-y divide-[var(--border)]">
                {recent.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-fg-muted">
                    Nothing yet.
                  </p>
                ) : (
                  recent.map((row) => (
                    <div
                      key={row.activity.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ActivityBadge type={row.activity.type} />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-fg">
                            {row.leadEmail ?? row.campaignName ?? "—"}
                          </p>
                          <p className="truncate text-[10px] text-fg-subtle">
                            {row.campaignName ?? row.mailboxEmail ?? ""}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-fg-subtle">
                        {formatRelative(row.activity.createdAt)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Campaign leaderboard */}
        {leaderboard.length > 0 ? (
          <Card>
            <CardHeader
              title="Campaign performance"
              description="Sorted by reply rate"
            />
            <CardBody className="p-0">
              <div className="divide-y divide-[var(--border)]">
                {leaderboard.map((c) => (
                  <Link
                    key={c.campaignId}
                    to={`/campaigns/${c.campaignId}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-muted/50"
                  >
                    <span className="truncate text-sm text-fg">{c.name}</span>
                    <span className="tabular shrink-0 text-[11px] text-fg-subtle">
                      {formatNumber(c.sent)} sent ·{" "}
                      {formatPercent(
                        c.sent ? (c.replied / c.sent) * 100 : 0,
                      )}{" "}
                      replied
                    </span>
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>
        ) : null}

        {/* Opportunities preview */}
        <Card>
          <CardHeader
            title="Open opportunities"
            description="Replies that turned into pipeline"
            actions={
              <Badge tone="accent">{formatCurrency(pipeline)} total</Badge>
            }
          />
          <CardBody className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {opportunityList.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-fg-muted">
                  No opportunities yet. A reply that asks about pricing, a
                  demo or a meeting shows up here.
                </p>
              ) : (
                opportunityList.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {o.leadCompany ??
                          [o.leadFirstName, o.leadLastName]
                            .filter(Boolean)
                            .join(" ") ??
                          o.leadEmail}
                      </p>
                      <p className="truncate text-xs text-fg-subtle">
                        {o.title}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone="success">{o.status}</Badge>
                      <span className="tabular w-20 text-right text-sm font-semibold text-fg">
                        {formatCurrency(o.value ?? 0)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}

function AttentionRow({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action: { label: string; to: string };
}) {
  return (
    <Link
      to={action.to}
      className="flex items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-surface-muted/50"
    >
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-fg">{title}</p>
        <p className="truncate text-[11px] text-fg-subtle">{detail}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent">
        {action.label}
        <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}
