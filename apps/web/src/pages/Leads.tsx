import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderPlus,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select, Field } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/Feedback";
import {
  TBody,
  TD,
  TH,
  THead,
  Table,
} from "@/components/ui/Table";
import { EmailStatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { ImportLeadsModal } from "@/components/ImportLeadsModal";
import { formatNumber, formatRelative, initials } from "@/lib/format";
import type { Campaign, Lead, LeadLabel } from "@/types";

const PAGE_SIZE = 25;

export function LeadsPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addToList, setAddToList] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const labelsQuery = useQuery({
    queryKey: ["lead-labels"],
    queryFn: () => api.get<{ data: { items: LeadLabel[] } }>("/leads/labels"),
  });

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<{ data: { items: Campaign[] } }>("/campaigns"),
  });

  const leadsQuery = useQuery({
    queryKey: [
      "leads",
      { page, search: debouncedSearch, statusFilter, emailFilter, campaignFilter },
    ],
    queryFn: () =>
      api.get<{ data: Lead[]; page: { nextCursor: string | null } }>("/leads", {
        query: {
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          search: debouncedSearch || undefined,
          statusId: statusFilter !== "all" ? statusFilter : undefined,
          emailStatus: emailFilter !== "all" ? emailFilter : undefined,
          campaignId: campaignFilter !== "all" ? campaignFilter : undefined,
        },
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => api.delete(`/leads/${id}`)));
    },
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const labels = labelsQuery.data?.data?.items ?? [];
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const campaigns = campaignsQuery.data?.data?.items ?? [];
  const leads = leadsQuery.data?.data ?? [];
  const nextCursor = leadsQuery.data?.page?.nextCursor;
  const hasNext = nextCursor !== null && nextCursor !== undefined;

  const allVisibleSelected =
    leads.length > 0 && leads.every((l) => selected.has(l.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const l of leads) next.delete(l.id);
      } else {
        for (const l of leads) next.add(l.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Page
      title="Leads"
      description="Every contact across every campaign, with its verification and reply status."
      actions={
        <>
          <Button variant="secondary" size="sm">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add lead
          </Button>
        </>
      }
    >
      <Card>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, company…"
              className="h-8 w-60 pl-8 text-xs"
            />
          </div>

          <Select
            value={campaignFilter}
            onChange={(e) => {
              setCampaignFilter(e.target.value);
              setPage(0);
            }}
            className="h-8 w-48 text-xs"
            aria-label="Filter by campaign"
          >
            <option value="all">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>

          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="h-8 w-40 text-xs"
            aria-label="Filter by status"
          >
            <option value="all">Any status</option>
            {labels.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.name}
              </option>
            ))}
          </Select>

          <Select
            value={emailFilter}
            onChange={(e) => {
              setEmailFilter(e.target.value);
              setPage(0);
            }}
            className="h-8 w-36 text-xs"
            aria-label="Filter by verification"
          >
            <option value="all">Any email</option>
            <option value="valid">Valid</option>
            <option value="risky">Risky</option>
            <option value="catch_all">Catch-all</option>
            <option value="invalid">Invalid</option>
            <option value="unknown">Unknown</option>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-fg-subtle">
              {leadsQuery.isLoading
                ? "Loading…"
                : `${formatNumber(leads.length)} on this page`}
            </span>
            <Button variant="ghost" size="sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Columns
            </Button>
          </div>
        </div>

        {/* Bulk bar */}
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-2">
            <span className="text-xs font-medium text-accent">
              {selected.size} selected
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAddToList(true)}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Add to list
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate([...selected])}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        ) : null}

        {leadsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-fg-muted">
            Loading leads…
          </div>
        ) : leadsQuery.isError ? (
          <div className="flex items-center justify-center py-16 text-sm text-danger">
            Failed to load leads
          </div>
        ) : leads.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No leads match"
            description="Adjust the filters, or add a lead to get started."
            action={
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add lead
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
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-[var(--accent)]"
                    aria-label="Select all on this page"
                  />
                </TH>
                <TH>Lead</TH>
                <TH>Company</TH>
                <TH>Status</TH>
                <TH>Email</TH>
                <TH align="right">Created</TH>
                <TH align="right">Last activity</TH>
              </tr>
            </THead>
            <TBody>
              {leads.map((lead) => {
                const label = lead.statusId
                  ? labelById.get(lead.statusId)
                  : undefined;
                return (
                  <tr
                    key={lead.id}
                    className="transition-colors hover:bg-surface-muted/70"
                  >
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.has(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-[var(--accent)]"
                        aria-label={`Select ${lead.email}`}
                      />
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-muted text-[10px] font-semibold text-fg-muted">
                          {initials(
                            `${lead.firstName ?? ""} ${lead.lastName ?? ""}`,
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fg">
                            {lead.firstName} {lead.lastName}
                          </p>
                          <p className="truncate text-[11px] text-fg-subtle">
                            {lead.email}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <div className="min-w-0 max-w-[180px]">
                        <p className="truncate text-sm text-fg">
                          {lead.company ?? "—"}
                        </p>
                        <p className="truncate text-[11px] text-fg-subtle">
                          {lead.title ?? ""}
                        </p>
                      </div>
                    </TD>
                    <TD>
                      {label ? (
                        <Badge
                          tone={
                            label.interest === "positive"
                              ? "success"
                              : label.interest === "negative"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {label.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-fg-subtle">—</span>
                      )}
                    </TD>
                    <TD>
                      <EmailStatusBadge status={lead.emailStatus} />
                    </TD>
                    <TD align="right">
                      <span className="text-xs text-fg-subtle">
                        {formatRelative(lead.createdAt)}
                      </span>
                    </TD>
                    <TD align="right">
                      <span className="text-xs text-fg-subtle">
                        {formatRelative(lead.lastActivityAt)}
                      </span>
                    </TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        )}

        {/* Pagination */}
        {leads.length > 0 || page > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2">
            <span className="text-xs text-fg-subtle">
              Page {page + 1}
              {hasNext ? " · more available" : " · end of results"}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <AddLeadModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["leads"] });
        }}
      />
      <ImportLeadsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => queryClient.invalidateQueries({ queryKey: ["leads"] })}
      />

      <AddToListModal
        open={addToList}
        leadIds={[...selected]}
        onClose={() => setAddToList(false)}
        onAdded={() => {
          setAddToList(false);
          setSelected(new Set());
          queryClient.invalidateQueries({ queryKey: ["lists"] });
        }}
      />
    </Page>
  );
}

/**
 * Adds the selected leads to a list.
 *
 * A list is a view over the workspace's leads, so adding one never
 * creates a contact — it only points at one.
 */
function AddToListModal({
  open,
  leadIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  leadIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [listId, setListId] = useState("");

  const lists = useQuery({
    queryKey: ["lists"],
    queryFn: () =>
      api.get<{ data: { items: Array<{ id: string; name: string; memberCount: number }> } }>(
        "/lists",
      ),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: () => api.post(`/lists/${listId}/members`, { leadIds }),
    onSuccess: onAdded,
  });

  const items = lists.data?.data?.items ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to a list"
      description={`${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} will be added.`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!listId || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "Adding…" : "Add to list"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-xs text-fg-subtle">
            No lists yet. Create one on the Lists page first.
          </p>
        ) : (
          <Select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            aria-label="List"
          >
            <option value="">Choose a list…</option>
            {items.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.memberCount})
              </option>
            ))}
          </Select>
        )}
      </div>
    </Modal>
  );
}

function AddLeadModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/leads", {
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        company: company.trim() || undefined,
        title: title.trim() || undefined,
      }),
    onSuccess: () => {
      setError(null);
      setEmail("");
      setFirstName("");
      setLastName("");
      setCompany("");
      setTitle("");
      onCreated();
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to add lead");
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add lead"
      description="A lead needs an email address. Everything else is optional."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={mutation.isPending}
            onClick={() => {
              if (!email.trim()) {
                setError("Email is required");
                return;
              }
              mutation.mutate();
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add lead
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Email" htmlFor="lead-email">
          <Input
            id="lead-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="lead-first">
            <Input
              id="lead-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Zahid"
            />
          </Field>
          <Field label="Last name" htmlFor="lead-last">
            <Input
              id="lead-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Khan"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" htmlFor="lead-company">
            <Input
              id="lead-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Corp"
            />
          </Field>
          <Field label="Job title" htmlFor="lead-title">
            <Input
              id="lead-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Head of Growth"
            />
          </Field>
        </div>
        {error ? (
          <div className="rounded-lg border border-[var(--danger)]/25 bg-danger-soft px-3 py-2 text-xs text-fg-muted">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
