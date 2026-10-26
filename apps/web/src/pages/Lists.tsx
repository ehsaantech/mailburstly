import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Copy,
  FolderPlus,
  List as ListIcon,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { Page } from "@/components/layout/AppShell";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Field, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/Feedback";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber, formatRelative, initials } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Api shapes                                                                  */
/* -------------------------------------------------------------------------- */

interface LeadList {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  memberCount: number;
  campaignCount: number;
}

interface ListDetail extends LeadList {
  breakdown: Array<{
    statusName: string | null;
    statusInterest: string | null;
    count: number;
  }>;
  campaigns: Array<{
    campaignId: string;
    name: string;
    status: string;
    enrollOnAdd: boolean;
  }>;
}

interface ListMember {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  emailStatus: string;
  statusName: string | null;
  statusInterest: string | null;
  addedAt: string;
}

interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function ListsPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const lists = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<{ data: { items: LeadList[] } }>("/lists"),
  });

  const items = lists.data?.data?.items ?? [];

  const create = useMutation({
    mutationFn: () =>
      api.post<{ data: { list: LeadList } }>("/lists", {
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: () => {
      setCreating(false);
      setName("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/lists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/lists/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  return (
    <Page
      title="Lead lists"
      description="Reusable contact collections you can attach to any campaign."
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          New list
        </Button>
      }
    >
      {lists.isLoading ? (
        <p className="text-xs text-fg-subtle">Loading lists…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FolderPlus className="h-5 w-5" />}
          title="No lists yet"
          description="A list is a named group of leads. Attach one to a campaign and everyone in it is enrolled."
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              Create a list
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((list) => (
            <Card key={list.id} className="flex flex-col">
              <CardBody className="flex-1 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => setOpenId(list.id)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                      <ListIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="line-clamp-2 text-sm font-medium text-fg">
                      {list.name}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Duplicate list"
                      onClick={() => duplicate.mutate(list.id)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete list"
                      onClick={() => remove.mutate(list.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <p className="line-clamp-2 min-h-[2rem] text-xs text-fg-muted">
                  {list.description ?? "No description."}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge tone="neutral">
                    {formatNumber(list.memberCount)} leads
                  </Badge>
                  {list.campaignCount > 0 ? (
                    <Badge tone="accent">
                      {list.campaignCount} campaign
                      {list.campaignCount === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                  <span className="ml-auto text-[11px] text-fg-subtle">
                    {formatDate(list.createdAt)}
                  </span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New lead list"
        description="Lists are reusable across campaigns. Duplicates are skipped on import."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={name.trim().length === 0 || create.isPending}
              onClick={() => create.mutate()}
            >
              Create list
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="List name" htmlFor="list-name">
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SaaS founders — US, 20–200 employees"
              autoFocus
            />
          </Field>
          <Field label="Description" hint="optional" htmlFor="list-desc">
            <Input
              id="list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Where these came from, how they were verified"
            />
          </Field>
        </div>
      </Modal>

      {openId ? (
        <ListDetailModal
          listId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() =>
            queryClient.invalidateQueries({ queryKey: ["lists"] })
          }
        />
      ) : null}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* One list                                                                    */
/* -------------------------------------------------------------------------- */

function ListDetailModal({
  listId,
  onClose,
  onChanged,
}: {
  listId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const detail = useQuery({
    queryKey: ["lists", listId],
    queryFn: () => api.get<{ data: { list: ListDetail } }>(`/lists/${listId}`),
  });

  const members = useQuery({
    queryKey: ["lists", listId, "members", query],
    queryFn: () =>
      api.get<{ data: ListMember[] }>(`/lists/${listId}/members`, {
        query: { search: query || undefined, limit: 100 },
      }),
  });

  const campaigns = useQuery({
    queryKey: ["campaigns", "list-attachment"],
    queryFn: () =>
      api.get<{ data: { items: Array<{ id: string; name: string; status: string }> } }>(
        "/campaigns",
      ),
  });

  const list = detail.data?.data?.list;
  // The members endpoint paginates, so the array sits directly under `data`.
  const memberItems = members.data?.data ?? [];

  const addMembers = useMutation({
    mutationFn: (leadIds: string[]) =>
      api.post(`/lists/${listId}/members`, { leadIds }),
    onSuccess: () => {
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const removeMember = useMutation({
    mutationFn: (leadId: string) =>
      api.delete(`/lists/${listId}/members/${leadId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const attach = useMutation({
    mutationFn: (campaignId: string) =>
      api.post(`/lists/${listId}/campaigns`, { campaignId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      onChanged();
    },
  });

  const detach = useMutation({
    mutationFn: (campaignId: string) =>
      api.delete(`/lists/${listId}/campaigns/${campaignId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      onChanged();
    },
  });

  const attached = new Set((list?.campaigns ?? []).map((c) => c.campaignId));
  const allCampaigns = campaigns.data?.data?.items ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={list?.name ?? "List"}
      description={
        list
          ? `${formatNumber(memberItems.length)} leads · created ${formatRelative(list.createdAt)}`
          : undefined
      }
      size="xl"
    >
      <div className="space-y-4">
        {/* The campaigns this list feeds */}
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-fg">Attached campaigns</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Attaching a list enrolls everyone in it. A lead added later is
            enrolled too, unless the campaign turned that off.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(list?.campaigns ?? []).map((c) => (
              <Badge key={c.campaignId} tone="accent">
                {c.name}
                <button
                  onClick={() => detach.mutate(c.campaignId)}
                  aria-label={`Detach ${c.name}`}
                  className="ml-1 opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              </Badge>
            ))}

            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) attach.mutate(e.target.value);
              }}
              className="h-7 w-48 text-[11px]"
              aria-label="Attach a campaign"
            >
              <option value="">Attach a campaign…</option>
              {allCampaigns
                .filter((c) => !attached.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </div>
        </div>

        {/* The members */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search leads…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add leads
            </Button>
          </div>

          {memberItems.length === 0 ? (
            <p className="py-8 text-center text-xs text-fg-subtle">
              No leads in this list yet.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              {memberItems.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-[10px] font-semibold text-fg-muted">
                    {initials(
                      [m.firstName, m.lastName].filter(Boolean).join(" ") ||
                        m.email,
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-fg">
                      {[m.firstName, m.lastName].filter(Boolean).join(" ") ||
                        m.email}
                    </p>
                    <p className="truncate text-[10px] text-fg-subtle">
                      {m.email}
                      {m.company ? ` · ${m.company}` : ""}
                    </p>
                  </div>
                  {m.statusName ? (
                    <Badge
                      tone={
                        m.statusInterest === "positive"
                          ? "success"
                          : m.statusInterest === "negative"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {m.statusName}
                    </Badge>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove from list"
                    onClick={() => removeMember.mutate(m.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {adding ? (
        <AddLeadsModal
          onClose={() => setAdding(false)}
          onAdd={(leadIds) => addMembers.mutate(leadIds)}
          pending={addMembers.isPending}
        />
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Add leads                                                                   */
/* -------------------------------------------------------------------------- */

function AddLeadsModal({
  onClose,
  onAdd,
  pending,
}: {
  onClose: () => void;
  onAdd: (leadIds: string[]) => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const leads = useQuery({
    queryKey: ["leads", "picker", query],
    queryFn: () =>
      api.get<{ data: { items: Lead[] } }>("/leads", {
        query: { search: query || undefined, limit: 50 },
      }),
  });

  const items = leads.data?.data?.items ?? [];

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add leads to this list"
      description="Pick the leads to add. A lead may be in many lists."
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-fg-subtle">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selected.size === 0 || pending}
              onClick={() => onAdd([...selected])}
            >
              Add {selected.size || ""}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads…"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {items.length === 0 ? (
            <p className="p-4 text-center text-xs text-fg-subtle">
              No leads found.
            </p>
          ) : (
            items.map((lead) => (
              <button
                key={lead.id}
                onClick={() => toggle(lead.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-muted/50",
                  selected.has(lead.id) && "bg-accent-soft/50",
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-[10px] font-semibold text-fg-muted">
                  {initials(
                    [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
                      lead.email,
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-fg">
                    {[lead.firstName, lead.lastName]
                      .filter(Boolean)
                      .join(" ") || lead.email}
                  </span>
                  <span className="block truncate text-[10px] text-fg-subtle">
                    {lead.email}
                    {lead.company ? ` · ${lead.company}` : ""}
                  </span>
                </span>
                {selected.has(lead.id) ? (
                  <Badge tone="accent">Added</Badge>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
