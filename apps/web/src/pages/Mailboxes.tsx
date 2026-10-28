import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Plus, RefreshCw, Tag } from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/Stat";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/Feedback";
import {
  HealthIndicator,
  MailboxStatusBadge,
  ProviderBadge,
} from "@/components/ui/status";
import { mailboxes as mockMailboxes } from "@/mocks/data";
import { api, USE_MOCKS } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Mailbox, MailboxProvider, MailboxStatus } from "@/types";

/* -------------------------------------------------------------------------- */
/* Api shapes                                                                  */
/* -------------------------------------------------------------------------- */

/** A mailbox as the api returns it. */
interface MailboxSummary {
  id: string;
  email: string;
  displayName: string | null;
  provider: MailboxProvider;
  status: MailboxStatus;
  dailyCap: number;
  healthScore: number;
  tags: string[];
  sentToday: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** The mock seed shaped like an api row, so one type covers both. */
function mockToSummary(mailbox: Mailbox): MailboxSummary {
  return {
    id: mailbox.id,
    email: mailbox.email,
    displayName: mailbox.displayName,
    provider: mailbox.provider,
    status: mailbox.status,
    dailyCap: mailbox.dailyCap,
    healthScore: mailbox.healthScore,
    tags: mailbox.tags,
    sentToday: mailbox.sentToday,
    lastCheckedAt: mailbox.lastCheckedAt,
    lastError: mailbox.lastError,
    createdAt: new Date().toISOString(),
  };
}

export function MailboxesPage() {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [provider, setProvider] = useState<"google" | "microsoft" | "imap_smtp">("google");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const mailboxesQuery = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () =>
      api.get<{ data: { items: MailboxSummary[] } }>("/mailboxes"),
    // In mock mode there is no api to call; the seed data stands in.
    enabled: !USE_MOCKS,
  });

  const mailboxes: MailboxSummary[] = USE_MOCKS
    ? mockMailboxes.map(mockToSummary)
    : (mailboxesQuery.data?.data?.items ?? []);

  const handleConnect = async () => {
    if (USE_MOCKS) {
      setConnectError(
        "Connect requires the real API. Set VITE_USE_MOCKS=false and run the Hono api.",
      );
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const result = await api.post<{ data: { url: string; accountId: string } }>(
        "/mailboxes/connect",
        {
          provider,
          email: email.trim() || undefined,
          displayName: displayName.trim() || undefined,
        },
      );
      // Single-use URL from EmailEngine; redirect the browser to it.
      window.location.href = result.data.url;
    } catch (error) {
      setConnectError(
        error instanceof Error ? error.message : "Failed to start connection",
      );
      setConnecting(false);
    }
  };

  const allTags = Array.from(new Set(mailboxes.flatMap((m) => m.tags))).sort();

  const filtered = selectedTag
    ? mailboxes.filter((m) => m.tags.includes(selectedTag))
    : mailboxes;

  const connected = mailboxes.filter((m) => m.status === "connected").length;
  const degraded = mailboxes.filter((m) => m.status === "degraded").length;
  const failed = mailboxes.filter((m) => m.status === "failed").length;
  const totalCap = mailboxes.reduce((s, m) => s + m.dailyCap, 0);
  const sentToday = mailboxes.reduce((s, m) => s + m.sentToday, 0);

  return (
    <Page
      title="Mailboxes"
      description="Every sending inbox, its health, and how much headroom it has left today."
      actions={
        <>
          <Button variant="secondary" size="sm">
            <RefreshCw className="h-3.5 w-3.5" />
            Re-check all
          </Button>
          <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Connect mailbox
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Capacity summary */}
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs font-medium text-fg-muted">
                Today's capacity
              </p>
              <p className="tabular mt-1 text-2xl font-semibold text-fg">
                {sentToday}
                <span className="ml-1 text-sm font-normal text-fg-subtle">
                  / {totalCap} emails
                </span>
              </p>
            </div>
            <div className="min-w-[200px] flex-1 max-w-xs">
              <ProgressBar
                value={(sentToday / Math.max(1, totalCap)) * 100}
                tone={
                  sentToday / Math.max(1, totalCap) > 0.85 ? "warning" : "accent"
                }
              />
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                {Math.round((sentToday / Math.max(1, totalCap)) * 100)}% of daily
                cap consumed
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <Metric label="Connected" value={connected} tone="success" />
              <Metric label="Degraded" value={degraded} tone="warning" />
              <Metric label="Failed" value={failed} tone="danger" />
            </div>
          </CardBody>
        </Card>

        {/* Tag filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSelectedTag(null)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              selectedTag === null
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-surface-muted hover:text-fg",
            )}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                selectedTag === tag
                  ? "bg-accent-soft text-accent"
                  : "text-fg-muted hover:bg-surface-muted hover:text-fg",
              )}
            >
              <Tag className="h-3 w-3" />
              {tag}
            </button>
          ))}
        </div>

        {/* Mailbox cards */}
        {filtered.length === 0 ? (
          <EmptyState
            title="No mailboxes yet"
            description="Connect a Gmail, Outlook or IMAP/SMTP mailbox to start sending. Every connected mailbox gets its own daily quota and health score."
            action={
              <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Connect mailbox
              </Button>
            }
          />
        ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 items-start">
          {filtered.map((m) => (
            <Card key={m.id} className="overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {m.email}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg-subtle">
                    {m.displayName ?? "—"}
                  </p>
                </div>
                <MailboxStatusBadge status={m.status} />
              </div>

              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <ProviderBadge provider={m.provider} />
                    {m.tags.map((t) => (
                      <Badge key={t} tone="neutral">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <HealthIndicator score={m.healthScore} />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-muted">Daily quota</span>
                    <span className="tabular font-medium text-fg">
                      {m.sentToday} / {m.dailyCap}
                    </span>
                  </div>
                  <ProgressBar
                    className="mt-1.5"
                    value={(m.sentToday / Math.max(1, m.dailyCap)) * 100}
                    tone={
                      m.sentToday / Math.max(1, m.dailyCap) > 0.9
                        ? "warning"
                        : m.status === "failed"
                          ? "danger"
                          : "accent"
                    }
                  />
                </div>

                {m.lastError ? (
                  <div className="flex items-start gap-2 rounded-md border border-[var(--danger)]/25 bg-danger-soft px-2.5 py-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                    <p className="text-[11px] leading-snug text-fg-muted">
                      {m.lastError}
                    </p>
                  </div>
                ) : null}

                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-[11px] text-fg-subtle">
                    Checked {formatRelative(m.lastCheckedAt)}
                  </span>
                  <Button variant="ghost" size="sm">
                    Settings
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
        )}
      </div>

      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect a mailbox"
        description="Mail Burstly delegates OAuth to EmailEngine, which handles the consent flow and token refresh."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={connecting}
              onClick={handleConnect}
            >
              <Plus className="h-3.5 w-3.5" />
              {provider === "imap_smtp" ? "Continue" : `Connect ${provider === "google" ? "Gmail" : "Outlook"}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Provider" htmlFor="provider">
            <Select
              id="provider"
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as "google" | "microsoft" | "imap_smtp")
              }
            >
              <option value="google">Google (Gmail / Workspace)</option>
              <option value="microsoft">Microsoft (Outlook / M365)</option>
              <option value="imap_smtp">IMAP/SMTP (manual)</option>
            </Select>
          </Field>

          <Field label="Email" hint="optional, pre-fills the form" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </Field>

          <Field label="Display name" hint="optional" htmlFor="display-name">
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Sarah Whitfield"
            />
          </Field>

          {connectError ? (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/25 bg-danger-soft px-3 py-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <p className="text-xs text-fg-muted">{connectError}</p>
            </div>
          ) : null}

          <p className="text-[11px] text-fg-subtle">
            You'll be redirected to EmailEngine's hosted auth form, then to
            Google or Microsoft to grant consent. The connection is verified
            before the mailbox appears here.
          </p>
        </div>
      </Modal>
    </Page>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger";
}) {
  const colors = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  };
  return (
    <div className="text-center">
      <p className={cn("tabular text-lg font-semibold", colors[tone])}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </p>
    </div>
  );
}
