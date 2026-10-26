import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  GripVertical,
  FlaskConical,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";

import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/Feedback";
import { api } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

interface Variant {
  id: string;
  stepId: string;
  label: string;
  subject: string | null;
  bodyHtml: string;
  weight: number;
  pinned: number;
}

interface Step {
  id: string;
  campaignId: string;
  position: number;
  subject: string | null;
  bodyHtml: string;
  bodyText: string | null;
  preheader: string | null;
  delayMinutes: number;
  threadMode: "reply" | "new_thread";
  variants: Variant[];
}

/* -------------------------------------------------------------------------- */
/* Delay helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A delay in days, because "waits 3 days" is what an operator means.
 *
 * The database stores minutes — a follow-up is often 40 minutes or 3 days,
 * and there is no unit that reads well for both. The editor asks for days and
 * converts; anything under a day is entered in hours.
 */
function delayToDays(minutes: number): { value: string; unit: "hours" | "days" } {
  if (minutes === 0) return { value: "0", unit: "hours" };
  if (minutes % 1440 === 0) {
    return { value: String(minutes / 1440), unit: "days" };
  }
  if (minutes % 60 === 0) {
    return { value: String(minutes / 60), unit: "hours" };
  }
  return { value: String(minutes), unit: "hours" };
}

function daysToMinutes(value: string, unit: "hours" | "days"): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return unit === "days" ? Math.round(n * 1440) : Math.round(n * 60);
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return "immediately";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

/* -------------------------------------------------------------------------- */
/* The editor                                                                  */
/* -------------------------------------------------------------------------- */

export function SequenceEditor({
  campaignId,
  canEdit,
}: {
  campaignId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();

  const stepsQuery = useQuery({
    queryKey: ["campaign-steps", campaignId],
    queryFn: () =>
      api.get<{ data: { items: Step[] } }>(`/campaigns/${campaignId}/steps`),
  });

  const steps = stepsQuery.data?.data?.items ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["campaign-steps", campaignId] });

  const addStep = useMutation({
    mutationFn: () =>
      api.post(`/campaigns/${campaignId}/steps`, {
        subject: "",
        bodyHtml: "<p>Hi {{first_name}},</p><p></p>",
        delayMinutes: 0,
        threadMode: "reply",
      }),
    onSuccess: invalidate,
  });

  const updateStep = useMutation({
    mutationFn: (input: {
      stepId: string;
      patch: Record<string, unknown>;
    }) =>
      api.patch(`/campaigns/${campaignId}/steps/${input.stepId}`, input.patch),
    onSuccess: invalidate,
  });

  const removeStep = useMutation({
    mutationFn: (stepId: string) =>
      api.delete(`/campaigns/${campaignId}/steps/${stepId}`),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (stepIds: string[]) =>
      api.patch(`/campaigns/${campaignId}/steps/reorder`, { stepIds }),
    onSuccess: invalidate,
  });

  /** Moves a step up or down and persists the whole new order. */
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const ids = steps.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    reorder.mutate(ids);
  };

  if (stepsQuery.isLoading) {
    return (
      <Card>
        <CardBody>
          <p className="text-xs text-fg-subtle">Loading the sequence…</p>
        </CardBody>
      </Card>
    );
  }

  if (steps.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Workflow className="h-5 w-5" />}
          title="No sequence yet"
          description="A campaign is a sequence of steps. Add the first one to get going."
          action={
            canEdit ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => addStep.mutate()}
                disabled={addStep.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                Add the first step
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {!canEdit ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/50 p-3">
          <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <p className="text-[11px] leading-snug text-fg-muted">
            This campaign is running, so its sequence is locked. Pause it to
            change the steps — a running campaign would otherwise send two
            different emails to different leads.
          </p>
        </div>
      ) : null}

      {steps.map((step, index) => (
        <StepCard
          key={step.id}
          step={step}
          index={index}
          total={steps.length}
          campaignId={campaignId}
          canEdit={canEdit}
          onMove={(direction) => move(index, direction)}
          onSave={(patch) =>
            updateStep.mutate({ stepId: step.id, patch })
          }
          onDelete={() => removeStep.mutate(step.id)}
          onChanged={invalidate}
        />
      ))}

      {canEdit ? (
        <Card>
          <CardBody className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              Add a follow-up step. Leaving the subject blank keeps it in the
              same thread.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => addStep.mutate()}
              disabled={addStep.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              Add step
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One step                                                                    */
/* -------------------------------------------------------------------------- */

function StepCard({
  step,
  index,
  total,
  campaignId,
  canEdit,
  onMove,
  onSave,
  onDelete,
  onChanged,
}: {
  step: Step;
  index: number;
  total: number;
  campaignId: string;
  canEdit: boolean;
  onMove: (direction: -1 | 1) => void;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(step.subject ?? "");
  const [body, setBody] = useState(step.bodyHtml);
  const [delay, setDelay] = useState(() => delayToDays(step.delayMinutes));
  const [threadMode, setThreadMode] = useState(step.threadMode);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  // Adopt the server's version when the step changes underneath us.
  useEffect(() => {
    setSubject(step.subject ?? "");
    setBody(step.bodyHtml);
    setDelay(delayToDays(step.delayMinutes));
    setThreadMode(step.threadMode);
  }, [step.id, step.subject, step.bodyHtml, step.delayMinutes, step.threadMode]);

  const dirty =
    subject !== (step.subject ?? "") ||
    body !== step.bodyHtml ||
    delayToDays(step.delayMinutes).value !== delay.value ||
    delayToDays(step.delayMinutes).unit !== delay.unit ||
    threadMode !== step.threadMode;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {canEdit ? (
            <span className="flex items-center gap-0.5">
              <button
                onClick={() => onMove(-1)}
                disabled={index === 0}
                aria-label="Move up"
                className="rounded p-0.5 text-fg-subtle transition-colors hover:text-fg disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onMove(1)}
                disabled={index === total - 1}
                aria-label="Move down"
                className="rounded p-0.5 text-fg-subtle transition-colors hover:text-fg disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : null}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[11px] font-semibold text-accent">
            {step.position}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">
              {step.subject?.trim() ? step.subject : "(no subject)"}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-subtle">
              <Clock className="h-3 w-3" />
              {index === 0
                ? "fires on enrollment"
                : `waits ${formatDelay(step.delayMinutes)}`}
              {step.variants.length > 0 ? (
                <span className="ml-1">
                  · {step.variants.length} variant
                  {step.variants.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge tone="outline">
            {step.threadMode === "reply" ? "Threaded" : "New thread"}
          </Badge>
          {canEdit ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTestOpen(true)}
              >
                <FlaskConical className="h-3.5 w-3.5" />
                Test
              </Button>
              <Button
                variant={open ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Close" : "Edit"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete step"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {open && canEdit ? (
        <CardBody className="space-y-4">
          <Field label="Subject" htmlFor={`subject-${step.id}`}>
            <Input
              id={`subject-${step.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Re: your email — leave blank to keep the thread"
            />
          </Field>

          <Field label="Body" htmlFor={`body-${step.id}`}>
            <Textarea
              id={`body-${step.id}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="font-mono text-[12px]"
            />
          </Field>

          <p className="-mt-2 text-[11px] text-fg-subtle">
            Variables:{" "}
            {[
              "{{first_name}}",
              "{{last_name}}",
              "{{company}}",
              "{{title}}",
              "{{email}}",
            ].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setBody((b) => `${b}${v}`)}
                className="mr-1 rounded bg-surface-muted px-1 py-0.5 font-mono text-[10px] text-fg-muted transition-colors hover:text-fg"
              >
                {v}
              </button>
            ))}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Wait before this step" htmlFor={`delay-${step.id}`}>
              <div className="flex items-center gap-2">
                <Input
                  id={`delay-${step.id}`}
                  type="number"
                  min={0}
                  step="1"
                  value={delay.value}
                  onChange={(e) =>
                    setDelay((d) => ({ ...d, value: e.target.value }))
                  }
                  className="w-20"
                />
                <Select
                  value={delay.unit}
                  onChange={(e) =>
                    setDelay((d) => ({
                      ...d,
                      unit: e.target.value as "hours" | "days",
                    }))
                  }
                  className="w-24"
                >
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </Select>
              </div>
            </Field>

            <Field label="Threading" htmlFor={`thread-${step.id}`}>
              <Select
                id={`thread-${step.id}`}
                value={threadMode}
                onChange={(e) =>
                  setThreadMode(e.target.value as "reply" | "new_thread")
                }
              >
                <option value="reply">Reply in thread</option>
                <option value="new_thread">New thread</option>
              </Select>
            </Field>

            <div className="flex items-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setVariantsOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                A/Z variants ({step.variants.length})
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty}
              onClick={() =>
                onSave({
                  subject: subject.trim() ? subject : null,
                  bodyHtml: body,
                  delayMinutes: daysToMinutes(delay.value, delay.unit),
                  threadMode,
                })
              }
            >
              Save step
            </Button>
          </div>
        </CardBody>
      ) : !open ? (
        <CardBody>
          <p className="whitespace-pre-line text-xs leading-relaxed text-fg-muted line-clamp-3">
            {stripHtml(body)}
          </p>
        </CardBody>
      ) : null}

      {variantsOpen ? (
        <VariantsModal
          campaignId={campaignId}
          step={step}
          onClose={() => setVariantsOpen(false)}
          onChanged={onChanged}
        />
      ) : null}

      {testOpen ? (
        <TestSendModal
          campaignId={campaignId}
          step={step}
          onClose={() => setTestOpen(false)}
        />
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* A/Z variants                                                                */
/* -------------------------------------------------------------------------- */

function VariantsModal({
  campaignId,
  step,
  onClose,
  onChanged,
}: {
  campaignId: string;
  step: Step;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(step.bodyHtml);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["campaign-steps", campaignId] });
    onChanged();
  };

  const create = useMutation({
    mutationFn: () =>
      api.post(`/campaigns/${campaignId}/steps/${step.id}/variants`, {
        label: label.trim() || nextLabel(step.variants),
        subject: subject.trim() || null,
        bodyHtml: body,
        weight: 100,
        pinned: false,
      }),
    onSuccess: () => {
      setLabel("");
      setSubject("");
      setError(null);
      refresh();
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : "The variant could not be saved"),
  });

  const remove = useMutation({
    mutationFn: (variantId: string) =>
      api.delete(`/campaigns/${campaignId}/steps/${step.id}/variants/${variantId}`),
    onSuccess: refresh,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="A/Z variants"
      description="Each lead gets one variant, chosen by weight. A pinned variant always wins."
      size="lg"
    >
      <div className="space-y-4">
        {step.variants.length === 0 ? (
          <p className="text-xs text-fg-subtle">
            No variants yet. Without one, every lead gets the step as written.
          </p>
        ) : (
          <div className="space-y-2">
            {step.variants.map((variant) => (
              <div
                key={variant.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted/40 p-3"
              >
                <Badge tone="accent">Variant {variant.label}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg">
                    {variant.subject?.trim() || "(reuses the step subject)"}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-muted">
                    {stripHtml(variant.bodyHtml)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-[10px] text-fg-subtle">
                    {variant.weight}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete variant"
                    onClick={() => remove.mutate(variant.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-fg">Add a variant</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Label" htmlFor="variant-label">
              <Input
                id="variant-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={nextLabel(step.variants)}
              />
            </Field>
            <Field label="Subject" htmlFor="variant-subject">
              <Input
                id="variant-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Leave blank to reuse the step subject"
              />
            </Field>
          </div>
          <Field label="Body" htmlFor="variant-body">
            <Textarea
              id="variant-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="font-mono text-[12px]"
            />
          </Field>
          {error ? <p className="text-[11px] text-danger">{error}</p> : null}
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add variant
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** The next unused A, B, C… label. */
function nextLabel(variants: Variant[]): string {
  const used = new Set(variants.map((v) => v.label.toUpperCase()));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letter of alphabet) {
    if (!used.has(letter)) return letter;
  }
  return `V${variants.length + 1}`;
}

/* -------------------------------------------------------------------------- */
/* Test send                                                                   */
/* -------------------------------------------------------------------------- */

function TestSendModal({
  campaignId,
  step,
  onClose,
}: {
  campaignId: string;
  step: Step;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api.post<{ data: { messageId: string; from: string } }>(
        `/campaigns/${campaignId}/test-send`,
        { to: to.trim(), stepId: step.id },
      ),
    onSuccess: (result) => {
      setSent(result.data.messageId);
      setError(null);
    },
    onError: (e) =>
      setError(
        e instanceof Error ? e.message : "The test could not be sent",
      ),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Send a test"
      description="The message goes out from the campaign's own mailbox, rendered with the same variables a lead would get."
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!to.trim() || send.isPending}
            onClick={() => send.mutate()}
          >
            <Send className="h-3.5 w-3.5" />
            {send.isPending ? "Sending…" : "Send test"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Send to" htmlFor="test-to">
          <Input
            id="test-to"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
        {sent ? (
          <p className="text-[11px] text-success">
            Sent. Check the inbox in a moment.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** The plain text of an html body, for the collapsed preview. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
