import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Copy,
  Pause,
  Play,
  Settings2,
  Users,
  Workflow,
} from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatTile, ProgressBar } from "@/components/ui/Stat";
import { Switch } from "@/components/ui/Switch";
import { EmptyState } from "@/components/ui/Feedback";
import {
  TBody,
  TD,
  TH,
  THead,
  Table,
} from "@/components/ui/Table";
import { AreaChart } from "@/components/charts/AreaChart";
import { SequenceEditor } from "@/components/sequence/SequenceEditor";
import { EmailStatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { ImportLeadsModal } from "@/components/ImportLeadsModal";
import { labelById } from "@/mocks/data";
import type { Mailbox } from "@/types";
import { cn } from "@/lib/cn";
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/format";
import type { Campaign, CampaignStep } from "@/types";

const tabs = [
  { key: "sequence", label: "Sequence", icon: Workflow },
  { key: "leads", label: "Leads", icon: Users },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings2 },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [tab, setTab] = useState<TabKey>("sequence");
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();

  const campaignQuery = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => api.get<{ data: { campaign: Campaign; leads: any[] } }>(`/campaigns/${campaignId}`),
    enabled: !!campaignId,
  });

  const stepsQuery = useQuery({
    queryKey: ["campaign-steps", campaignId],
    queryFn: () => api.get<{ data: { items: any[] } }>(`/campaigns/${campaignId}/steps`),
    enabled: !!campaignId,
  });

  const campaign = campaignQuery.data?.data?.campaign;
  const steps = (stepsQuery.data?.data?.items ?? []) as CampaignStep[];

  const launchMutation = useMutation({
    mutationFn: () => api.post(`/campaigns/${campaignId}/launch`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const campaignListsQuery = useQuery({
    queryKey: ["campaign-lists", campaignId],
    queryFn: () =>
      api.get<{ data: { items: Array<{ id: string; name: string; description: string | null; memberCount: number }> } }>(
        `/campaigns/${campaignId}/lists`,
      ),
    enabled: !!campaignId,
  });

  const allListsQuery = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<{ data: { items: Array<{ id: string; name: string; campaignCount: number }> } }>("/lists"),
    enabled: !!campaignId,
  });

  const attachListMutation = useMutation({
    mutationFn: (listId: string) =>
      api.post(`/campaigns/${campaignId}/lists`, { listId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-lists", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const detachListMutation = useMutation({
    mutationFn: (listId: string) =>
      api.delete(`/campaigns/${campaignId}/lists/${listId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-lists", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => api.post(`/campaigns/${campaignId}/pause`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  if (campaignQuery.isLoading || stepsQuery.isLoading) {
    return (
      <Page title="Loading…">
        <div className="flex items-center justify-center py-20 text-sm text-fg-muted">
          Loading campaign…
        </div>
      </Page>
    );
  }

  if (campaignQuery.isError || !campaign) {
    return (
      <Page title="Campaign not found">
        <EmptyState
          title="That campaign doesn't exist"
          description="It may have been deleted, or the link is wrong."
          action={
            <Link
              to="/campaigns"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-fg hover:bg-surface-muted"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to campaigns
            </Link>
          }
        />
      </Page>
    );
  }

  const replyRate = campaign.sent === 0 ? 0 : (campaign.replied / campaign.sent) * 100;
  const positiveRate = campaign.replied === 0 ? 0 : (campaign.positiveReplies / campaign.replied) * 100;

  return (
    <>
    <Page
      title={campaign.name}
      description={`${formatNumber(campaign.leadCount)} leads · launched ${campaign.launchedAt ? formatRelative(campaign.launchedAt) : "not yet"}`}
      actions={
        <>
          <Button variant="secondary" size="sm">
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </Button>
          {campaign.status === "active" ? (
            <Button variant="secondary" size="sm" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => launchMutation.mutate()} disabled={launchMutation.isPending}>
              <Play className="h-3.5 w-3.5" />
              {campaign.status === "draft" ? "Launch" : "Resume"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {campaign.pausedReason ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-[var(--warning)]/30 bg-warning-soft px-3.5 py-2.5">
            <Pause className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">Campaign paused</p>
              <p className="mt-0.5 text-xs text-fg-muted">{campaign.pausedReason}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Contacted" value={formatNumber(campaign.contacted)} hint={`${campaign.progress}% of ${formatNumber(campaign.leadCount)}`} />
          <StatTile label="Reply rate" value={formatPercent(replyRate)} hint={`${formatNumber(campaign.replied)} replies`} />
          <StatTile label="Positive" value={formatPercent(positiveRate)} hint={`${formatNumber(campaign.positiveReplies)} positive replies`} />
          <StatTile label="Opportunities" value={formatNumber(campaign.opportunities)} hint={formatCurrency(campaign.opportunityValue)} />
          <StatTile label="Bounced" value={formatNumber(campaign.bounced)} hint={`${formatPercent(campaign.sent === 0 ? 0 : (campaign.bounced / campaign.sent) * 100, 2)} of sent`} />
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-border">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "sequence" ? (
          <SequenceEditor
            campaignId={campaign.id}
            canEdit={campaign.status !== "active"}
          />
        ) : null}
        {tab === "sequence" ? <DiagnoseCard campaignId={campaign.id} /> : null}
        {tab === "leads" ? (
          <LeadsTab
            leads={campaignQuery.data?.data?.leads ?? []}
            lists={campaignListsQuery.data?.data?.items ?? []}
            allLists={allListsQuery.data?.data?.items ?? []}
            onImport={() => setImportOpen(true)}
            onAttach={(listId) => attachListMutation.mutate(listId)}
            onDetach={(listId) => detachListMutation.mutate(listId)}
            attaching={attachListMutation.isPending}
          />
        ) : null}
        {tab === "analytics" ? <AnalyticsTab steps={steps} /> : null}
        {tab === "settings" ? (
          <SettingsTab
            campaignId={campaign.id}
            status={campaign.status}
            dailyLimit={campaign.dailyLimit ?? 0}
            dailyMaxLeads={campaign.dailyMaxLeads ?? 0}
          />
        ) : null}
      </div>
    </Page>
    <ImportLeadsModal
      open={importOpen}
      onClose={() => setImportOpen(false)}
      campaignId={campaignId}
      onImported={() => queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] })}
    />
    </>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * Why is this campaign not sending?
 *
 * The answer is the single most useful thing on the page when a campaign
 * looks stuck, so it sits at the top of the sequence tab rather than behind
 * a button.
 */
function DiagnoseCard({ campaignId }: { campaignId: string }) {
  const query = useQuery({
    queryKey: ["analytics", "diagnose", campaignId],
    queryFn: () =>
      api.get<{
        data: {
          diagnosis: {
            reason: string;
            message: string;
            remedy: string | null;
          };
        };
      }>(`/analytics/diagnose/${campaignId}`),
  });

  const diagnosis = query.data?.data?.diagnosis;

  const tone =
    diagnosis?.reason === "sending"
      ? "success"
      : diagnosis?.reason === "campaign_draft" ||
          diagnosis?.reason === "paused"
        ? "neutral"
        : "warning";

  return (
    <Card className="mt-4">
      <CardHeader
        title="Why is this campaign not sending?"
        description="Checked against the schedule, the daily limit, the mailboxes and the enrolled leads."
        actions={
          diagnosis ? (
            <Badge tone={tone as "success" | "neutral" | "warning"}>
              {diagnosis.reason.replace(/_/g, " ")}
            </Badge>
          ) : null
        }
      />
      <CardBody>
        {query.isLoading ? (
          <p className="text-xs text-fg-subtle">Checking…</p>
        ) : !diagnosis ? (
          <p className="text-xs text-fg-subtle">
            The diagnosis could not be loaded.
          </p>
        ) : (
          <div className="flex items-start gap-2.5">
            <div
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                diagnosis.reason === "sending"
                  ? "bg-success-soft text-success"
                  : "bg-warning-soft text-warning",
              )}
            >
              {diagnosis.reason === "sending" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-fg">{diagnosis.message}</p>
              {diagnosis.remedy ? (
                <p className="mt-1 text-[11px] text-fg-muted">
                  {diagnosis.remedy}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function LeadsTab({
  leads: rows,
  lists,
  allLists,
  onImport,
  onAttach,
  onDetach,
  attaching,
}: {
  leads: any[];
  lists: Array<{ id: string; name: string; description: string | null; memberCount: number }>;
  allLists: Array<{ id: string; name: string; campaignCount: number }>;
  onImport: () => void;
  onAttach: (listId: string) => void;
  onDetach: (listId: string) => void;
  attaching: boolean;
}) {
  const attachedIds = new Set(lists.map((l) => l.id));
  const available = allLists.filter((l) => !attachedIds.has(l.id));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium text-fg">Attached lists</p>
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg"
              value=""
              disabled={attaching || available.length === 0}
              onChange={(e) => {
                if (e.target.value) onAttach(e.target.value);
              }}
              aria-label="Attach a list"
            >
              <option value="">
                {available.length === 0 ? "No lists to attach" : "Attach a list…"}
              </option>
              {available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" onClick={onImport}>
              <Users className="h-3.5 w-3.5" />
              Import leads
            </Button>
          </div>
        </div>
        <div className="p-4">
          {lists.length === 0 ? (
            <p className="text-xs text-fg-subtle">
              No lists attached yet. Attaching a list enrolls all of its leads
              into this campaign and runs the sequence on them.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {lists.map((list) => (
                <span
                  key={list.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-fg"
                >
                  <span className="font-medium">{list.name}</span>
                  <span className="text-fg-subtle">{list.memberCount} leads</span>
                  <button
                    onClick={() => onDetach(list.id)}
                    aria-label={`Detach ${list.name}`}
                    className="ml-0.5 text-fg-subtle hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No leads in this campaign yet"
            description="Import a CSV or attach an existing list to enroll leads."
            action={
              <Button variant="primary" size="sm" onClick={onImport}>
                Import leads
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <Table>
        <THead>
          <tr>
            <TH>Lead</TH>
            <TH>Company</TH>
            <TH>Status</TH>
            <TH>Email</TH>
            <TH align="right">Last activity</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((lead: any) => (
            <tr key={lead.id} className="transition-colors hover:bg-surface-muted/70">
              <TD>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{lead.firstName} {lead.lastName}</p>
                  <p className="truncate text-[11px] text-fg-subtle">{lead.email}</p>
                </div>
              </TD>
              <TD>
                <div className="min-w-0 max-w-[180px]">
                  <p className="truncate text-sm text-fg">{lead.company ?? "—"}</p>
                  <p className="truncate text-[11px] text-fg-subtle">{lead.title ?? ""}</p>
                </div>
              </TD>
              <TD>
                {labelById.get(lead.statusId) ? (
                  <Badge tone={labelById.get(lead.statusId)!.interest === "positive" ? "success" : labelById.get(lead.statusId)!.interest === "negative" ? "danger" : "neutral"}>
                    {labelById.get(lead.statusId)!.name}
                  </Badge>
                ) : (
                  <span className="text-xs text-fg-subtle">—</span>
                )}
              </TD>
              <TD>
                <EmailStatusBadge status={lead.emailStatus ?? "unknown"} />
              </TD>
              <TD align="right">
                <span className="text-xs text-fg-subtle">{formatRelative(lead.lastActivityAt)}</span>
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Card>
      )}
      </div>
  );
}

/* ------------------------------------------------------------------------- */

function AnalyticsTab({ steps }: { steps: CampaignStep[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Campaign trend" description="Sent and replied across the last 30 days" />
        <CardBody>
          <AreaChart
            data={[]}
            series={[
              { key: "sent", label: "Sent", color: "var(--accent)", fill: true },
              { key: "replied", label: "Replied", color: "var(--success)", fill: true, axis: "right" },
            ]}
            height={220}
            formatValue={(v) => formatCompact(v)}
          />
          <p className="mt-2 text-center text-xs text-fg-subtle">Analytics data will populate once the worker starts recording activity.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Step analytics" description="Which follow-up is actually working" />
        <Table>
          <THead>
            <tr>
              <TH>Step</TH>
              <TH align="right">Sent</TH>
              <TH align="right">Opened</TH>
              <TH align="right">Open rate</TH>
              <TH align="right">Replied</TH>
              <TH align="right">Reply rate</TH>
            </tr>
          </THead>
          <TBody>
            {steps.map((s: any) => {
              const openRate = (s.sent ?? 0) === 0 ? 0 : ((s.opened ?? 0) / (s.sent ?? 1)) * 100;
              const replyRate = (s.sent ?? 0) === 0 ? 0 : ((s.replied ?? 0) / (s.sent ?? 1)) * 100;
              return (
                <tr key={s.id} className="transition-colors hover:bg-surface-muted/70">
                  <TD>
                    <span className="text-sm font-medium text-fg">Step {s.position}</span>
                    <span className="ml-2 text-xs text-fg-subtle">{(s.variants?.length ?? 1)} variant(s)</span>
                  </TD>
                  <TD align="right" className="tabular text-fg-muted">{formatNumber(s.sent ?? 0)}</TD>
                  <TD align="right" className="tabular text-fg-muted">{formatNumber(s.opened ?? 0)}</TD>
                  <TD align="right" className="tabular text-fg-muted">{formatPercent(openRate)}</TD>
                  <TD align="right" className="tabular text-fg-muted">{formatNumber(s.replied ?? 0)}</TD>
                  <TD align="right" className="tabular font-medium">
                    <span className={replyRate >= 4 ? "text-success" : "text-fg-muted"}>{formatPercent(replyRate)}</span>
                  </TD>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function SettingsTab({
  campaignId,
  status,
  dailyLimit,
  dailyMaxLeads,
}: {
  campaignId: string;
  status: string;
  dailyLimit: number;
  dailyMaxLeads: number;
}) {
  const [stopOnReply, setStopOnReply] = useState(true);
  const [stopOnAutoReply, setStopOnAutoReply] = useState(false);
  const [stopForCompany, setStopForCompany] = useState(true);
  const [openTracking, setOpenTracking] = useState(true);
  const [linkTracking, setLinkTracking] = useState(true);
  const [textOnly, setTextOnly] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Schedule & limits" description="Sending windows and daily caps" />
        <CardBody className="space-y-4">
          <Row label="Sending window" value="Mon–Fri · 09:00–17:00 · America/New_York" />
          <Row label="Daily campaign limit" value={dailyLimit ? `${dailyLimit} emails` : "Unlimited"} />
          <Row label="Max new leads / day" value={dailyMaxLeads ? `${dailyMaxLeads}` : "Unlimited"} />
          <Row label="Time gap between emails" value="9 min + 0–5 min jitter" />
          <Row label="Status" value={status} capitalize />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sending rules" description="When to stop emailing a lead" />
        <CardBody className="space-y-4">
          <Switch id="stop-reply" label="Stop on reply" description="Any reply stops all remaining steps." checked={stopOnReply} onChange={setStopOnReply} />
          <Switch id="stop-auto" label="Stop on auto-reply" description="Leave off to let out-of-office replies auto-resume." checked={stopOnAutoReply} onChange={setStopOnAutoReply} />
          <Switch id="stop-company" label="Stop for company" description="If one lead at a company replies, stop the rest at that domain." checked={stopForCompany} onChange={setStopForCompany} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tracking" description="Applies to every step in this campaign" />
        <CardBody className="space-y-4">
          <Switch id="open-tracking" label="Open tracking" description="Adds a tracking pixel. Slightly hurts deliverability." checked={openTracking} onChange={setOpenTracking} />
          <Switch id="link-tracking" label="Link tracking" description="Rewrite links to count clicks." checked={linkTracking} onChange={setLinkTracking} />
          <Switch id="text-only" label="Text-only sending" description="No HTML, no images, no tracking. Best deliverability." checked={textOnly} onChange={setTextOnly} />
        </CardBody>
      </Card>

      <MailboxAssignment campaignId={campaignId} />
    </div>
  );
}

function Row({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className={cn("text-right text-sm font-medium text-fg", capitalize && "capitalize")}>{value}</span>
    </div>
  );
}
/* ------------------------------------------------------------------------- */

function MailboxAssignment({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();

  const allQuery = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => api.get<{ data: { items: Mailbox[] } }>("/mailboxes"),
  });

  const assignedQuery = useQuery({
    queryKey: ["campaign-mailboxes", campaignId],
    queryFn: () =>
      api.get<{ data: { mailboxIds: string[] } }>(`/campaigns/${campaignId}/mailboxes`),
  });

  const [selected, setSelected] = useState<string[] | null>(null);

  const assigned = assignedQuery.data?.data?.mailboxIds ?? [];
  const all = allQuery.data?.data?.items ?? [];
  const current = selected ?? assigned;

  const mutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.post(`/campaigns/${campaignId}/mailboxes`, { mailboxIds: ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["campaign-mailboxes", campaignId],
      });
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    },
  });

  const toggle = (id: string) => {
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    setSelected(next);
    mutation.mutate(next);
  };

  return (
    <Card>
      <CardHeader
        title="Sending mailboxes"
        description="Which inboxes this campaign may send from"
        actions={
          mutation.isPending ? (
            <span className="text-[11px] text-fg-subtle">Saving…</span>
          ) : null
        }
      />
      <CardBody className="space-y-2">
        {all.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg-muted">
            No connected mailboxes yet.
          </p>
        ) : (
          <>
            {all.map((m) => {
              const checked = current.includes(m.id);
              return (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-surface-muted/50"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(m.id)}
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">
                        {m.email}
                      </span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        {m.status} · health {Math.round(m.healthScore)} ·{" "}
                        {m.sentToday}/{m.dailyCap} sent today
                      </span>
                    </span>
                  </span>
                  <ProgressBar
                    value={(m.sentToday / m.dailyCap) * 100}
                    className="w-20 shrink-0"
                    tone={m.sentToday / m.dailyCap > 0.9 ? "warning" : "accent"}
                  />
                </label>
              );
            })}
            <p className="pt-1 text-[11px] text-fg-subtle">
              With nothing selected, the scheduler uses every connected
              mailbox. Assign mailboxes to keep one client&apos;s campaigns off
              another client&apos;s inboxes.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
