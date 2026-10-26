import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Send } from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/Feedback";
import { ProgressBar } from "@/components/ui/Stat";
import {
  TBody,
  TD,
  TH,
  THead,
  Table,
} from "@/components/ui/Table";
import { CampaignStatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/format";
import type { Campaign } from "@/types";

const filters = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "draft", label: "Draft" },
  { key: "completed", label: "Completed" },
] as const;

export function CampaignsPage() {
  const [filter, setFilter] = useState<(typeof filters)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [dailyLimit, setDailyLimit] = useState("30");
  const [dailyMaxLeads, setDailyMaxLeads] = useState("50");
  const [createError, setCreateError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<{ data: { items: Campaign[] } }>("/campaigns"),
  });

  const campaigns = (data?.data?.items ?? []) as Campaign[];

  const createMutation = useMutation({
    mutationFn: (input: { name: string; dailyLimit: number; dailyMaxLeads: number }) =>
      api.post<{ data: { campaign: Campaign } }>("/campaigns", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setCreateOpen(false);
      setName("");
      setCreateError(null);
    },
    onError: (error) => {
      setCreateError(error instanceof Error ? error.message : "Failed to create campaign");
    },
  });

  const handleCreate = () => {
    if (!name.trim()) {
      setCreateError("Campaign name is required");
      return;
    }
    setCreateError(null);
    createMutation.mutate({
      name: name.trim(),
      dailyLimit: Number(dailyLimit) || 30,
      dailyMaxLeads: Number(dailyMaxLeads) || 50,
    });
  };

  const filtered = campaigns.filter((c) => {
    const matchesFilter = filter === "all" || c.status === filter;
    const matchesQuery =
      query.trim() === "" ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.tags.some((t) => t.toLowerCase().includes(query.toLowerCase()));
    return matchesFilter && matchesQuery;
  });

  const counts = {
    all: campaigns.length,
    active: campaigns.filter((c) => c.status === "active").length,
    paused: campaigns.filter((c) => c.status === "paused").length,
    draft: campaigns.filter((c) => c.status === "draft").length,
    completed: campaigns.filter((c) => c.status === "completed").length,
  };

  return (
    <Page
      title="Campaigns"
      description="Every sequence, its pacing, and what it has produced."
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New campaign
        </Button>
      }
    >
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {filters.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                  )}
                >
                  {f.label}
                  <span className={cn("tabular rounded-full px-1.5 py-0.5 text-[10px] leading-none", active ? "bg-accent text-accent-fg" : "bg-surface-muted")}>
                    {counts[f.key] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter campaigns…" className="h-8 w-56 pl-8 text-xs" />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-fg-muted">Loading campaigns…</div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16 text-sm text-danger">Failed to load campaigns</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Send className="h-5 w-5" />}
            title={campaigns.length === 0 ? "No campaigns yet" : "No campaigns match"}
            description={campaigns.length === 0 ? "Create your first campaign to get started." : "Adjust the filter or create a new campaign."}
            action={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New campaign
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Campaign</TH>
                <TH>Status</TH>
                <TH align="right">Leads</TH>
                <TH align="right">Sent</TH>
                <TH align="right">Reply rate</TH>
                <TH align="right">Positive</TH>
                <TH align="right">Pipeline</TH>
                <TH>Progress</TH>
                <TH align="right">Launched</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((c) => (
                <CampaignRow key={c.id} campaign={c} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New campaign"
        description="Create a draft campaign. Add steps and leads, then launch when ready."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" loading={createMutation.isPending} onClick={handleCreate}>
              <Plus className="h-3.5 w-3.5" />
              Create campaign
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Campaign name" htmlFor="campaign-name">
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q4 · US SaaS Founders"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily email limit" htmlFor="daily-limit">
              <Input
                id="daily-limit"
                type="number"
                min={1}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
              />
            </Field>
            <Field label="Max new leads / day" htmlFor="max-leads">
              <Input
                id="max-leads"
                type="number"
                min={0}
                value={dailyMaxLeads}
                onChange={(e) => setDailyMaxLeads(e.target.value)}
              />
            </Field>
          </div>
          {createError ? (
            <div className="rounded-lg border border-[var(--danger)]/25 bg-danger-soft px-3 py-2 text-xs text-fg-muted">
              {createError}
            </div>
          ) : null}
          <p className="text-[11px] text-fg-subtle">
            The campaign starts as a draft. Add a step, enroll leads, then launch.
          </p>
        </div>
      </Modal>
    </Page>
  );
}

function CampaignRow({ campaign: c }: { campaign: Campaign }) {
  const replyRate = c.sent === 0 ? 0 : (c.replied / c.sent) * 100;

  return (
    <tr className="transition-colors hover:bg-surface-muted/70">
      <TD>
        <Link to={`/campaigns/${c.id}`} className="group block min-w-0 max-w-[280px]">
          <span className="block truncate text-sm font-medium text-fg group-hover:text-accent">{c.name}</span>
          <span className="mt-0.5 flex flex-wrap gap-1">
            {c.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-fg-subtle">{t}</span>
            ))}
          </span>
        </Link>
      </TD>
      <TD><CampaignStatusBadge status={c.status} /></TD>
      <TD align="right" className="tabular text-fg-muted">{formatNumber(c.leadCount)}</TD>
      <TD align="right" className="tabular text-fg-muted">{formatNumber(c.sent)}</TD>
      <TD align="right" className="tabular">
        <span className="font-medium text-fg-muted">{formatPercent(replyRate)}</span>
      </TD>
      <TD align="right" className="tabular text-fg-muted">{formatNumber(c.positiveReplies)}</TD>
      <TD align="right" className="tabular font-medium">
        {c.opportunityValue === 0 ? (
          <span className="font-normal text-fg-subtle">—</span>
        ) : (
          <span className="text-fg">{formatCurrency(c.opportunityValue)}</span>
        )}
      </TD>
      <TD>
        <div className="flex items-center gap-2">
          <ProgressBar value={c.progress} className="w-16" />
          <span className="tabular text-[11px] text-fg-subtle">{c.progress}%</span>
        </div>
      </TD>
      <TD align="right">
        <span className="text-xs text-fg-subtle">{c.launchedAt ? formatRelative(c.launchedAt) : "—"}</span>
      </TD>
    </tr>
  );
}