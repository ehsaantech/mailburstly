import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Archive,
  Bell,
  CalendarClock,
  CheckCheck,
  Inbox,
  Mail,
  Paperclip,
  Reply,
  Search,
  Send,
  Sparkles,
  UserPlus,
} from "lucide-react";

import { Page } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/Feedback";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative, initials } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Api shapes                                                                  */
/* -------------------------------------------------------------------------- */

type Folder =
  | "primary"
  | "unread"
  | "reminders"
  | "scheduled"
  | "sent"
  | "others"
  | "archived";

interface ConversationSummary {
  id: string;
  contactEmail: string;
  subject: string | null;
  status: "open" | "closed" | "archived";
  hasReply: number;
  hasUnread: number;
  remindAt: string | null;
  scheduledReplyAt: string | null;
  lastMessageAt: string | null;
  mailboxId: string;
  campaignId: string | null;
  leadId: string | null;
  mailboxEmail: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadCompany: string | null;
}

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddress: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  snippet: string | null;
  classification: string;
  isAutoReply: number;
  isOutOfOffice: number;
  oooResumeAt: string | null;
  isUnsubscribe: number;
  receivedAt: string;
}

interface Conversation extends ConversationSummary {
  messages: Message[];
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
  } | null;
}

interface StatusLabel {
  id: number;
  name: string;
  interest: "positive" | "neutral" | "negative";
}

interface Opportunity {
  id: string;
  title: string;
  summary: string | null;
  status: "open" | "won" | "lost";
  value: number | null;
  createdAt: string;
  leadId: string;
  leadEmail: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadCompany: string | null;
}

interface Macro {
  id: string;
  name: string;
  bodyHtml: string;
  bodyText: string | null;
}

interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
}

const folders: Array<{ key: Folder; label: string; icon: typeof Inbox }> = [
  { key: "primary", label: "Primary", icon: Inbox },
  { key: "unread", label: "Unread", icon: Mail },
  { key: "reminders", label: "Reminders", icon: Bell },
  { key: "scheduled", label: "Scheduled", icon: CalendarClock },
  { key: "sent", label: "Sent", icon: Send },
  { key: "others", label: "Others", icon: UserPlus },
  { key: "archived", label: "Archived", icon: Archive },
];

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function InboxPage() {
  const [view, setView] = useState<"threads" | "opportunities">("threads");
  const [folder, setFolder] = useState<Folder>("primary");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [remindOpen, setRemindOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const queryClient = useQueryClient();

  const conversationsQuery = useQuery({
    queryKey: ["inbox", "conversations", folder, query],
    queryFn: () =>
      api.get<{ data: { items: ConversationSummary[]; total: number } }>(
        "/inbox/conversations",
        {
          query: { folder, search: query || undefined, limit: 100 },
        },
      ),
  });

  const opportunitiesQuery = useQuery({
    queryKey: ["inbox", "opportunities"],
    queryFn: () =>
      api.get<{ data: { items: Opportunity[] } }>("/inbox/opportunities", {
        query: { limit: 100 },
      }),
    enabled: view === "opportunities",
  });

  const labelsQuery = useQuery({
    queryKey: ["inbox", "labels"],
    queryFn: () => api.get<{ data: { items: StatusLabel[] } }>("/inbox/labels"),
  });

  const macrosQuery = useQuery({
    queryKey: ["inbox", "macros"],
    queryFn: () => api.get<{ data: { items: Macro[] } }>("/inbox/macros"),
  });

  const threadQuery = useQuery({
    queryKey: ["inbox", "conversation", selectedId],
    queryFn: () =>
      api.get<{ data: { conversation: Conversation } }>(
        `/inbox/conversations/${selectedId}`,
      ),
    enabled: Boolean(selectedId),
  });

  const conversations = conversationsQuery.data?.data?.items ?? [];
  const selected = threadQuery.data?.data?.conversation ?? null;
  const labels = labelsQuery.data?.data?.items ?? [];
  const macros = macrosQuery.data?.data?.items ?? [];
  const opportunities = opportunitiesQuery.data?.data?.items ?? [];

  // Opening a conversation marks it read. A reply that stays unread is a
  // reply nobody answered.
  useEffect(() => {
    if (!selectedId || !selected?.hasUnread) return;
    void api
      .patch(`/inbox/conversations/${selectedId}`, { read: true })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["inbox"] });
      })
      .catch(() => {
        /* Marking read is best effort — it must never break the panel. */
      });
  }, [selectedId, selected?.hasUnread, queryClient]);

  const reply = useMutation({
    mutationFn: (body: { bodyHtml: string; bodyText: string }) =>
      api.post<{ data: { messageId: string } }>(
        `/inbox/conversations/${selectedId}/reply`,
        body,
      ),
    onSuccess: () => {
      setDraft("");
      setSendError(null);
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
    onError: (error) => {
      setSendError(
        error instanceof Error ? error.message : "The reply could not be sent",
      );
    },
  });

  const schedule = useMutation({
    mutationFn: (input: { bodyHtml: string; bodyText: string; sendAt: string }) =>
      api.post(`/inbox/conversations/${selectedId}/schedule`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const remind = useMutation({
    mutationFn: (remindAt: string | null) =>
      api.post(`/inbox/conversations/${selectedId}/remind`, { remindAt }),
    onSuccess: () => {
      setRemindOpen(false);
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const attachLead = useMutation({
    mutationFn: (leadId: string) =>
      api.post(`/inbox/conversations/${selectedId}/attach-lead`, { leadId }),
    onSuccess: () => {
      setAttachOpen(false);
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const closeConversation = useMutation({
    mutationFn: (status: "open" | "closed" | "archived") =>
      api.patch(`/inbox/conversations/${selectedId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const suggest = useMutation({
    mutationFn: () =>
      api.post<{ data: { draft: string; model: string | null } }>(
        `/inbox/conversations/${selectedId}/suggest`,
        { tone: "direct" },
      ),
    onSuccess: (result) => {
      setDraft((current) =>
        current.trim()
          ? `${current}

${result.data.draft}`
          : result.data.draft,
      );
    },
  });

  const handleSend = () => {
    if (!draft.trim()) return;
    setSendError(null);
    reply.mutate({ bodyHtml: draft, bodyText: draft });
  };

  const handleSchedule = (when: string) => {
    if (!draft.trim()) return;
    schedule.mutate({
      bodyHtml: draft,
      bodyText: draft,
      sendAt: new Date(when).toISOString(),
    });
    setDraft("");
  };

  return (
    <Page
      title="Inbox"
      description="Replies from the people you are emailing, and the opportunities they represent."
      actions={
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <Button
            variant={view === "threads" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("threads")}
          >
            Threads
          </Button>
          <Button
            variant={view === "opportunities" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("opportunities")}
          >
            Opportunities
          </Button>
        </div>
      }
    >
      {view === "opportunities" ? (
        <OpportunitiesPanel opportunities={opportunities} />
      ) : (
        <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[176px_360px_minmax(0,1fr)]">
          {/* Folder rail */}
          <nav className="hidden w-44 shrink-0 overflow-y-auto rounded-xl border border-border bg-surface/50 p-2 md:block">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Folders
            </p>
            <ul className="space-y-0.5">
              {folders.map((f) => {
                const active = folder === f.key;
                return (
                  <li key={f.key}>
                    <button
                      onClick={() => setFolder(f.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "bg-accent-soft text-accent"
                          : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                      )}
                    >
                      <f.icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 text-left">{f.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Lead status
            </p>
            <ul className="space-y-0.5">
              {labels
                .filter((l) => l.interest === "positive")
                .map((l) => (
                  <li key={l.id}>
                    <span className="flex items-center gap-2 px-2 py-1.5 text-xs text-fg-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      {l.name}
                    </span>
                  </li>
                ))}
            </ul>
          </nav>

          {/* Conversation list */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
            <div className="space-y-2 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search replies…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto md:hidden">
                {folders.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFolder(f.key)}
                    className={cn(
                      "whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      folder === f.key
                        ? "bg-accent-soft text-accent"
                        : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {conversationsQuery.isLoading ? (
                <p className="p-4 text-xs text-fg-subtle">Loading…</p>
              ) : conversations.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-5 w-5" />}
                  title="Nothing here"
                  description={`No conversations in ${folders.find((f) => f.key === folder)?.label.toLowerCase()}.`}
                />
              ) : (
                conversations.map((c) => {
                  const isActive = c.id === selectedId;
                  const name =
                    [c.leadFirstName, c.leadLastName].filter(Boolean).join(" ") ||
                    c.contactEmail;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "flex w-full gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors",
                        isActive
                          ? "bg-accent-soft/60"
                          : "hover:bg-surface-muted/60",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                          c.hasUnread
                            ? "border-accent-border bg-accent-soft text-accent"
                            : "border-border bg-surface-muted text-fg-muted",
                        )}
                      >
                        {initials(name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={cn(
                              "truncate text-xs",
                              c.hasUnread
                                ? "font-semibold text-fg"
                                : "font-medium text-fg-muted",
                            )}
                          >
                            {name}
                          </p>
                          <span className="shrink-0 text-[10px] text-fg-subtle">
                            {formatRelative(c.lastMessageAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-fg-muted">
                          {c.subject ?? "(no subject)"}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {c.remindAt ? (
                            <Badge tone="warning">
                              <Bell className="h-2.5 w-2.5" />
                              {formatRelative(c.remindAt)}
                            </Badge>
                          ) : null}
                          {c.scheduledReplyAt ? (
                            <Badge tone="accent">
                              <CalendarClock className="h-2.5 w-2.5" />
                              scheduled
                            </Badge>
                          ) : null}
                          {!c.leadId ? (
                            <Badge tone="neutral">unmatched</Badge>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Thread */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
            {!selected ? (
              <EmptyState
                icon={<Mail className="h-5 w-5" />}
                title="Select a conversation"
                description="Pick a reply on the left to read the thread and respond."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-fg">
                      {selected.subject ?? "(no subject)"}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-fg-muted">
                      {selected.contactEmail}
                      {selected.lead?.company ? ` · ${selected.lead.company}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-fg-subtle">
                      Via {selected.mailboxEmail} · {selected.messages.length}{" "}
                      messages
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selected.remindAt ? (
                      <Badge tone="warning">
                        <Bell className="h-2.5 w-2.5" />
                        {formatRelative(selected.remindAt)}
                      </Badge>
                    ) : null}
                    {!selected.leadId ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAttachOpen(true)}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Attach lead
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setRemindOpen(true)}
                    >
                      <Bell className="h-3.5 w-3.5" />
                      Remind
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        closeConversation.mutate(
                          selected.status === "closed" ? "open" : "closed",
                        )
                      }
                    >
                      {selected.status === "closed" ? "Reopen" : "Close"}
                    </Button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  {selected.messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[85%] rounded-xl border px-3.5 py-2.5",
                        m.direction === "outbound"
                          ? "ml-auto border-accent-border bg-accent-soft/50"
                          : "border-border bg-surface-muted/40",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-[11px] font-medium text-fg">
                          {m.direction === "outbound"
                            ? `${m.fromAddress} (you)`
                            : m.fromAddress}
                        </span>
                        <span className="shrink-0 text-[10px] text-fg-subtle">
                          {formatRelative(m.receivedAt)}
                        </span>
                      </div>

                      {m.classification !== "other" &&
                      m.classification !== "unclassified" ? (
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge
                            tone={
                              m.classification === "positive"
                                ? "success"
                                : m.classification === "negative"
                                  ? "danger"
                                  : m.classification === "out_of_office"
                                    ? "warning"
                                    : "neutral"
                            }
                          >
                            {m.classification.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      ) : null}

                      <p className="whitespace-pre-line text-xs leading-relaxed text-fg-muted">
                        {m.textBody ?? m.snippet ?? ""}
                      </p>

                      {m.isOutOfOffice ? (
                        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1">
                          <Sparkles className="h-3 w-3 text-warning" />
                          <span className="text-[10px] text-fg-muted">
                            Out of office
                            {m.oooResumeAt
                              ? ` — the sequence resumes on ${formatRelative(m.oooResumeAt)}`
                              : " — the sequence resumes on the next tick"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/* Composer */}
                <div className="shrink-0 border-t border-border bg-surface/60 p-3">
                  <div className="rounded-lg border border-border bg-surface">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={`Reply to ${selected.contactEmail}…`}
                      rows={3}
                      className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
                    />
                    <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
                      <div className="flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" aria-label="Attach file">
                          <Paperclip className="h-3.5 w-3.5" />
                        </Button>
                        {macros.length > 0 ? (
                          <Select
                            value=""
                            onChange={(e) => {
                              const macro = macros.find(
                                (m) => m.id === e.target.value,
                              );
                              if (macro) setDraft((d) => (d ? `${d}\n\n${macro.bodyHtml}` : macro.bodyHtml));
                            }}
                            aria-label="Macros"
                            className="h-7 w-32 text-[11px]"
                          >
                            <option value="">Macro…</option>
                            {macros.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </Select>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={suggest.isPending}
                          onClick={() => suggest.mutate()}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {suggest.isPending ? "Writing…" : "Suggest"}
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="icon" aria-label="Reply">
                          <Reply className="h-3.5 w-3.5" />
                        </Button>
                        <ScheduleButton
                          disabled={draft.trim().length === 0}
                          onSchedule={handleSchedule}
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={draft.trim().length === 0 || reply.isPending}
                          onClick={handleSend}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {reply.isPending ? "Sending…" : "Send"}
                          <CheckCheck className="w-3 h-3 opacity-60" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  {sendError || suggest.isError ? (
                    <p className="mt-1.5 px-1 text-[11px] text-danger">
                      {sendError ??
                        (suggest.error instanceof Error
                          ? suggest.error.message
                          : "No suggestion could be generated")}
                    </p>
                  ) : (
                    <p className="mt-1.5 px-1 text-[10px] text-fg-subtle">
                      Replying from {selected.mailboxEmail} — a manual reply
                      stops the sequence for this lead
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reminder */}
      <Modal
        open={remindOpen}
        onClose={() => setRemindOpen(false)}
        title="Remind me about this"
        description="The conversation shows up in Reminders until the time passes."
        size="sm"
      >
        <div className="space-y-3">
          <div>
            <label
              htmlFor="remind-at"
              className="mb-1.5 block text-xs font-medium text-fg-muted"
            >
              When
            </label>
            <Input
              id="remind-at"
              type="datetime-local"
              defaultValue={defaultReminderValue()}
            />
          </div>
          <div className="flex justify-end gap-2">
            {selected?.remindAt ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remind.mutate(null)}
                disabled={remind.isPending}
              >
                Clear reminder
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const input = document.getElementById(
                  "remind-at",
                ) as HTMLInputElement | null;
                if (!input?.value) return;
                remind.mutate(new Date(input.value).toISOString());
              }}
              disabled={remind.isPending}
            >
              Set reminder
            </Button>
          </div>
        </div>
      </Modal>

      {/* Attach a lead */}
      <AttachLeadModal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onAttach={(leadId) => attachLead.mutate(leadId)}
        pending={attachLead.isPending}
      />
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Schedule a reply                                                            */
/* -------------------------------------------------------------------------- */

function ScheduleButton({
  disabled,
  onSchedule,
}: {
  disabled: boolean;
  onSchedule: (when: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Schedule
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule this reply"
        description="It goes out from the mailbox the conversation arrived on."
        size="sm"
      >
        <div className="space-y-3">
          <div>
            <label
              htmlFor="send-at"
              className="mb-1.5 block text-xs font-medium text-fg-muted"
            >
              Send at
            </label>
            <Input
              id="send-at"
              type="datetime-local"
              defaultValue={defaultReminderValue()}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const input = document.getElementById(
                  "send-at",
                ) as HTMLInputElement | null;
                if (!input?.value) return;
                onSchedule(input.value);
                setOpen(false);
              }}
            >
              Schedule
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Attach a lead                                                              */
/* -------------------------------------------------------------------------- */

function AttachLeadModal({
  open,
  onClose,
  onAttach,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onAttach: (leadId: string) => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState("");

  const leads = useQuery({
    queryKey: ["leads", "attach", query],
    queryFn: () =>
      api.get<{ data: { items: Lead[] } }>("/leads", {
        query: { search: query || undefined, limit: 20 },
      }),
    enabled: open,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach a lead"
      description="Links this conversation to a lead and moves it into Primary."
      size="sm"
    >
      <div className="space-y-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search leads…"
        />
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          {(leads.data?.data?.items ?? []).map((lead) => (
            <button
              key={lead.id}
              onClick={() => onAttach(lead.id)}
              disabled={pending}
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-muted"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-muted text-[10px] font-semibold text-fg-muted">
                {initials(
                  [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
                    lead.email,
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-fg">
                  {[lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
                    lead.email}
                </span>
                <span className="block truncate text-[10px] text-fg-subtle">
                  {lead.email}
                  {lead.company ? ` · ${lead.company}` : ""}
                </span>
              </span>
            </button>
          ))}
          {(leads.data?.data?.items ?? []).length === 0 ? (
            <p className="p-3 text-[11px] text-fg-subtle">No leads found.</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

function OpportunitiesPanel({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles className="h-5 w-5" />}
        title="No opportunities yet"
        description="A reply that asks about pricing, a demo or a meeting shows up here."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {opportunities.map((o) => (
        <div
          key={o.id}
          className="rounded-xl border border-border bg-surface p-3.5"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">{o.title}</h3>
            <Badge tone={o.status === "open" ? "accent" : "neutral"}>
              {o.status}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {[o.leadFirstName, o.leadLastName].filter(Boolean).join(" ") ||
              o.leadEmail}
            {o.leadCompany ? ` · ${o.leadCompany}` : ""}
          </p>
          {o.summary ? (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-fg-muted">
              {o.summary}
            </p>
          ) : null}
          <p className="mt-2 text-[10px] text-fg-subtle">
            {formatRelative(o.createdAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Tomorrow at 09:00, in the browser's own timezone. */
function defaultReminderValue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
