import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Archive, Copy, Edit, Pause, Play, Plus, Search, Send, Trash2 } from "lucide-react";
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDailyLimit, setEditDailyLimit] = useState("");
  const [editDailyMaxLeads, setEditDailyMaxLeads] = useState("");
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

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/archive`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/duplicate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/pause`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
  const resumeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/resume`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; name: string; tags: string[]; dailyLimit: number; dailyMaxLeads: number }) =>
      api.patch(`/campaigns/${input.id}`, {
        name: input.name,
        tags: input.tags,
        dailyLimit: input.dailyLimit,
        dailyMaxLeads: input.dailyMaxLeads,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setEditId(null);
    },
  });
  const bulkMutation = useMutation({
    mutationFn: (input: { action: "pause" | "resume" | "archive" | "delete" | "duplicate"; ids: string[] }) =>
      api.post("/campaigns/bulk", input),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const openEdit = (c: Campaign) => {
    setEditId(c.id);
    setEditName(c.name);
    setEditTags((c.tags ?? []).join(", "));
    setEditDailyLimit(String(c.dailyLimit ?? ""));
    setEditDailyMaxLeads(String(c.dailyMaxLeads ?? ""));
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

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-2">
            <span className="text-xs font-medium text-accent">{selected.size} selected</span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="sm" loading={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: "pause", ids: [...selected] })}>Pause</Button>
              <Button variant="secondary" size="sm" loading={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: "resume", ids: [...selected] })}>Resume</Button>
              <Button variant="secondary" size="sm" loading={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: "archive", ids: [...selected] })}>Archive</Button>
              <Button variant="secondary" size="sm" loading={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: "duplicate", ids: [...selected] })}>Duplicate</Button>
              <Button variant="danger" size="sm" loading={bulkMutation.isPending} onClick={() => { if (window.confirm("Archive the selected campaigns?")) bulkMutation.mutate({ action: "archive", ids: [...selected] }); }}>Delete</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          </div>
        ) : null}

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
                <TH className="w-8">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-[var(--accent)]"
                    checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                    onChange={() => {
                      const next = new Set(selected);
                      if (filtered.every((c) => selected.has(c.id))) {
                        for (const c of filtered) next.delete(c.id);
                      } else {
                        for (const c of filtered) next.add(c.id);
                      }
                      setSelected(next);
                    }}
                    aria-label="Select all campaigns"
                  />
                </TH>
                <TH>Campaign</TH>
                <TH>Status</TH>
                <TH align="right">Leads</TH>
                <TH align="right">Sent</TH>
                <TH align="right">Reply rate</TH>
                <TH align="right">Positive</TH>
                <TH align="right">Pipeline</TH>
                <TH>Progress</TH>
                <TH align="right">Launched</TH>
                <TH align="right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((c) => {
                const replyRate = c.sent === 0 ? 0 : (c.replied / c.sent) * 100;
                const busy = pauseMutation.isPending || resumeMutation.isPending || archiveMutation.isPending || duplicateMutation.isPending;
                return (
                  <tr key={c.id} className="transition-colors hover:bg-surface-muted/70">
                    <TD>
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-[var(--accent)]"
                        checked={selected.has(c.id)}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          setSelected(next);
                        }}
                        aria-label={`Select ${c.name}`}
                      />
                    </TD>
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
                    <TD align="right">
                      <div className="flex items-center justify-end gap-1">
                        {c.status === "active" ? (
                          <Button variant="ghost" size="icon" aria-label="Pause" disabled={busy} onClick={() => pauseMutation.mutate(c.id)}>
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" aria-label="Resume" disabled={busy} onClick={() => resumeMutation.mutate(c.id)}>
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => openEdit(c)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Duplicate"
                          disabled={duplicateMutation.isPending}
                          onClick={() => duplicateMutation.mutate(c.id)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Archive"
                          disabled={archiveMutation.isPending}
                          onClick={() => archiveMutation.mutate(c.id)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete"
                          className="text-danger hover:text-danger"
                          onClick={() => setConfirmId(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TD>
                  </tr>
                );
              })}
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
      <Modal
        open={Boolean(editId)}
        onClose={() => setEditId(null)}
        title="Edit campaign"
        description="Update the campaign basics and caps."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={updateMutation.isPending}
              onClick={() => {
                if (!editId) return;
                updateMutation.mutate({
                  id: editId,
                  name: editName.trim() || "Untitled campaign",
                  tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
                  dailyLimit: Number(editDailyLimit) || 30,
                  dailyMaxLeads: Number(editDailyMaxLeads) || 50,
                });
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Campaign name" htmlFor="edit-campaign-name">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Campaign name" autoFocus />
          </Field>
          <Field label="Tags" htmlFor="edit-campaign-tags" hint="comma separated">
            <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="outbound, q4" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily email limit" htmlFor="edit-daily-limit">
              <Input type="number" min={1} value={editDailyLimit} onChange={(e) => setEditDailyLimit(e.target.value)} />
            </Field>
            <Field label="Max new leads / day" htmlFor="edit-max-leads">
              <Input type="number" min={0} value={editDailyMaxLeads} onChange={(e) => setEditDailyMaxLeads(e.target.value)} />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmId)}
        onClose={() => setConfirmId(null)}
        title="Archive campaign?"
        description="This archives the campaign and stops further sends. Archived campaigns can be restored later."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              loading={archiveMutation.isPending}
              onClick={() => {
                if (!confirmId) return;
                archiveMutation.mutate(confirmId);
                setConfirmId(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Archive
            </Button>
          </>
        }
      >
        <p className="text-xs text-fg-muted">
          Archived campaigns stop sending and hide from the active list.
        </p>
      </Modal>
    </Page>
  );
}

