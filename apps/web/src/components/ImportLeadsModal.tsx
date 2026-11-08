import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Upload } from "lucide-react";
import {
  isBlockingIssue,
  normalizeEmail,
  parseLeadsText,
  validateLeadRow,
  type LeadPayload,
  type LeadRowError,
} from "@mailrung/shared";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FileDropZone } from "@/components/import/FileDropZone";
import { ManualLeadTable } from "@/components/import/ManualLeadTable";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export type ImportMode = "paste" | "table";

interface ImportResult {
  created: number;
  skipped: number;
  rejected: number;
  errors: LeadRowError[];
  enrolled: number;
}

/**
 * Import leads.
 *
 * Two ways in, one engine underneath:
 *
 *   - **File / paste** — drop a CSV on the box or paste the text. The file
 *     is read in the browser, so a dropped file behaves exactly like a
 *     picked one.
 *   - **Manual table** — type or paste rows into a grid, fix what is
 *     broken, remove what you do not want, then send it in one request.
 *
 * Both share the validation in `@mailrung/shared`, so a broken address is
 * flagged before the request goes out and, if one slips through, the api
 * rejects that row alone instead of the whole batch.
 */
export function ImportLeadsModal({
  open,
  onClose,
  onImported,
  campaignId,
  listId,
  initialMode = "paste",
  initialRows = 5,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: (result: {
    created: number;
    skipped: number;
    rejected?: number;
    enrolled?: number;
  }) => void;
  campaignId?: string;
  /** Add the imported leads to this list as well. */
  listId?: string;
  /** Which tab opens first. */
  initialMode?: ImportMode;
  /** How many blank rows the manual table starts with. */
  initialRows?: number;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [tableState, setTableState] = useState<{
    payloads: LeadPayload[];
    counts: { ready: number; invalid: number; duplicate: number; total: number };
  }>({ payloads: [], counts: { ready: 0, invalid: 0, duplicate: 0, total: 0 } });

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  /**
   * The pasted text, checked row by row. A row with a broken address is
   * reported here and left out of the request; it never fails the batch.
   */
  const paste = useMemo(() => {
    const parsed = parseLeadsText(text);
    const seen = new Set<string>();
    const invalid: { row: number; email: string; message: string }[] = [];
    const ready: LeadPayload[] = [];
    let duplicate = 0;

    parsed.leads.forEach((lead, index) => {
      const issues = validateLeadRow(
        {
          email: lead.email ?? "",
          firstName: lead.firstName ?? "",
          lastName: lead.lastName ?? "",
          company: lead.company ?? "",
          title: lead.title ?? "",
          phone: lead.phone ?? "",
          linkedinUrl: lead.linkedinUrl ?? "",
          photoUrl: lead.photoUrl ?? "",
        },
        { seenEmails: seen },
      );
      const blocking = issues.filter(isBlockingIssue);
      if (blocking.length > 0) {
        invalid.push({
          row: index + 1,
          email: lead.email ?? "",
          message: blocking[0]!.message,
        });
        return;
      }
      const email = normalizeEmail(lead.email ?? "");
      if (seen.has(email)) {
        duplicate += 1;
        return;
      }
      seen.add(email);
      ready.push({ ...lead, email });
    });

    return {
      ready,
      invalid,
      duplicate,
      total: parsed.leads.length,
      unmapped: parsed.unmapped,
    };
  }, [text]);

  const mutation = useMutation({
    mutationFn: async (leads: LeadPayload[]) => {
      const importRes = await api.post<{
        data: {
          created: number;
          skipped: number;
          rejected?: number;
          leadIds?: string[];
          errors?: LeadRowError[];
        };
      }>("/leads/import", { leads });

      const data = importRes.data;
      const leadIds = data.leadIds ?? [];
      let enrolled = 0;

      if (campaignId && leadIds.length > 0) {
        const enrollRes = await api.post<{ data: { enrolled: number } }>(
          `/campaigns/${campaignId}/leads`,
          { leadIds },
        );
        enrolled = enrollRes.data.enrolled ?? leadIds.length;
      }

      if (listId && leadIds.length > 0) {
        await api.post(`/lists/${listId}/members`, { leadIds });
      }

      return {
        created: data.created,
        skipped: data.skipped,
        rejected: data.rejected ?? data.errors?.length ?? 0,
        errors: data.errors ?? [],
        enrolled,
      };
    },
    onSuccess: (r) => {
      setError(null);
      setResult(r);
      qc.invalidateQueries({ queryKey: ["leads"] });
      if (campaignId) {
        qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
        qc.invalidateQueries({ queryKey: ["campaigns"] });
      }
      onImported?.(r);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Import failed");
    },
  });

  const reset = () => {
    setText("");
    setError(null);
    setResult(null);
  };

  /** True when the operator typed something we would throw away on close. */
  const dirty =
    text.trim() !== "" ||
    tableState.counts.total > 0;

  const close = () => {
    if (dirty && !result) {
      const confirmed =
        typeof window === "undefined" ||
        window.confirm("Discard the leads you entered?");
      if (!confirmed) return;
    }
    reset();
    onClose();
  };

  const payloads = mode === "table" ? tableState.payloads : paste.ready;

  const startImport = (leads: LeadPayload[]) => {
    if (leads.length === 0) return;
    mutation.mutate(leads);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={campaignId ? "Import leads into this campaign" : "Import leads"}
      description={
        campaignId
          ? "Drop a CSV, paste it, or type the rows in. Leads are created if new and enrolled in this campaign."
          : "Drop a CSV, paste it, or type the rows in. Existing emails are skipped."
      }
      size="xl"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          {result ? (
            <span className="mr-auto text-xs text-fg-muted">
              {result.created} created · {result.skipped} skipped
              {result.rejected > 0 ? ` · ${result.rejected} rejected` : ""}
              {campaignId && result.enrolled > 0
                ? ` · ${result.enrolled} enrolled`
                : ""}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={close}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result ? (
            <Button
              variant="primary"
              size="sm"
              loading={mutation.isPending}
              disabled={payloads.length === 0}
              onClick={() => startImport(payloads)}
            >
              <Upload className="h-3.5 w-3.5" />
              Import {payloads.length > 0 ? payloads.length : ""}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-3">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-border bg-surface-muted p-0.5">
          {(
            [
              { key: "paste", label: "File / paste" },
              { key: "table", label: "Manual table" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                mode === tab.key
                  ? "bg-surface text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === "paste" ? (
          <>
            <FileDropZone
              value={text}
              onChange={(next) => {
                setText(next);
                setResult(null);
              }}
              onError={(message) => {
                setError(message);
                setResult(null);
              }}
              count={paste.total}
            />

            {paste.total > 0 ? (
              <p className="text-xs text-fg-muted">
                {paste.total} row{paste.total === 1 ? "" : "s"} ·{" "}
                <span className="text-fg">{paste.ready.length} ready</span>
                {paste.invalid.length > 0 ? (
                  <>
                    {" · "}
                    <span className="text-danger">
                      {paste.invalid.length} invalid
                    </span>
                  </>
                ) : null}
                {paste.duplicate > 0 ? (
                  <>
                    {" · "}
                    <span className="text-warning">
                      {paste.duplicate} duplicate
                    </span>
                  </>
                ) : null}
                {paste.unmapped.length > 0 ? (
                  <>
                    {" · "}
                    <span className="text-fg-subtle">
                      ignored columns: {paste.unmapped.join(", ")}
                    </span>
                  </>
                ) : null}
              </p>
            ) : null}

            {paste.invalid.length > 0 ? (
              <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                  <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                  {paste.invalid.length} row
                  {paste.invalid.length === 1 ? "" : "s"} will be left out
                </p>
                <ul className="mt-1.5 space-y-1">
                  {paste.invalid.slice(0, 10).map((row) => (
                    <li key={`${row.row}-${row.email}`} className="text-xs text-fg-muted">
                      <span className="font-mono text-fg">{row.email || "(empty)"}</span>
                      {" — "}
                      {row.message}
                    </li>
                  ))}
                  {paste.invalid.length > 10 ? (
                    <li className="text-xs text-fg-subtle">
                      …and {paste.invalid.length - 10} more
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <ManualLeadTable
            onImport={startImport}
            onStateChange={setTableState}
            initialRows={initialRows}
          />
        )}

        {error ? <p className="text-xs text-danger">{error}</p> : null}

        {result && result.errors.length > 0 ? (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
              <AlertTriangle className="h-3.5 w-3.5 text-danger" />
              {result.errors.length} row{result.errors.length === 1 ? "" : "s"}{" "}
              rejected
            </p>
            <ul className="mt-1.5 space-y-1">
              {result.errors.slice(0, 10).map((row) => (
                <li key={`${row.row}-${row.email}`} className="text-xs text-fg-muted">
                  Row {row.row}:{" "}
                  <span className="font-mono text-fg">{row.email || "(empty)"}</span>
                  {" — "}
                  {row.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {result ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setResult(null);
                setText("");
              }}
            >
              Import another batch
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
