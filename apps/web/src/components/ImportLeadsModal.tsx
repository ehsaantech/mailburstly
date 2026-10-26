import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";

interface ParsedLead {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

/** Parse pasted CSV (or one email per line) into lead objects. */
export function parseLeadsCsv(text: string): ParsedLead[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const first = (lines[0] ?? "").toLowerCase();
  const hasHeader =
    first.includes("email") ||
    first.includes("first") ||
    first.includes("company") ||
    first.includes("title");

  let headerCols: string[] = [];
  let dataLines = lines;
  if (hasHeader) {
    headerCols = splitLine(lines[0]!).map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
    dataLines = lines.slice(1);
  }

  const col = (cols: string[], name: string, aliases: string[] = []) => {
    const names = [name, ...aliases].map((n) => n.toLowerCase().replace(/[\s_-]/g, ""));
    const idx = headerCols.findIndex((h) => names.includes(h.replace(/[\s_-]/g, "")));
    return idx >= 0 ? cols[idx]?.trim() : undefined;
  };

  const out: ParsedLead[] = [];
  for (const line of dataLines) {
    const cols = splitLine(line);
    let lead: ParsedLead;
    if (hasHeader) {
      const email =
        col(cols, "email", ["e-mail", "emailaddress"]) || cols[0]?.trim() || "";
      lead = {
        email: email as string,
        firstName: col(cols, "firstname", ["first", "first_name", "fname"]) || undefined,
        lastName: col(cols, "lastname", ["last", "last_name", "lname", "surname"]) || undefined,
        company: col(cols, "company", ["organization", "org", "account"]) || undefined,
        title: col(cols, "title", ["jobtitle", "job_title", "role"]) || undefined,
      };
    } else {
      lead = {
        email: cols[0]?.trim() ?? "",
        firstName: cols[1]?.trim() || undefined,
        lastName: cols[2]?.trim() || undefined,
        company: cols[3]?.trim() || undefined,
        title: cols[4]?.trim() || undefined,
      };
    }
    if (lead.email && lead.email.includes("@")) out.push(lead);
  }
  return out;
}

export function ImportLeadsModal({
  open,
  onClose,
  onImported,
  campaignId,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: (result: { created: number; skipped: number; enrolled?: number }) => void;
  campaignId?: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; enrolled: number } | null>(null);

  const parsed = parseLeadsCsv(text);

  const mutation = useMutation({
    mutationFn: async () => {
      const importRes = await api.post<{ data: { created: number; skipped: number; leadIds: string[] } }>(
        "/leads/import",
        { leads: parsed },
      );
      const leadIds = importRes.data.leadIds ?? [];
      let enrolled = 0;
      if (campaignId && leadIds.length > 0) {
        const enrollRes = await api.post<{ data: { enrolled: number } }>(
          `/campaigns/${campaignId}/leads`,
          { leadIds },
        );
        enrolled = enrollRes.data.enrolled ?? leadIds.length;
      }
      return {
        created: importRes.data.created,
        skipped: importRes.data.skipped,
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

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={campaignId ? "Import leads into this campaign" : "Import leads"}
      description={
        campaignId
          ? "Paste a CSV (email, firstName, lastName, company, title) or one email per line. Leads are created if new and enrolled in this campaign."
          : "Paste a CSV (email, firstName, lastName, company, title) or one email per line. Existing emails are skipped."
      }
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={mutation.isPending}
            disabled={parsed.length === 0}
            onClick={() => mutation.mutate()}
          >
            <Upload className="h-3.5 w-3.5" />
            Import {parsed.length > 0 ? parsed.length : ""}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-muted">
            <FileText className="h-3.5 w-3.5" />
            Choose file
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => setText(String(reader.result ?? ""));
                reader.readAsText(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-xs text-fg-subtle">
            {parsed.length > 0
              ? `${parsed.length} lead${parsed.length === 1 ? "" : "s"} detected`
              : "No leads detected yet"}
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`email,firstName,lastName,company,title\njane@acme.com,Jane,Doe,Acme,VP Sales\njohn@beta.io,John,Smith,Beta,Founder`}
          className="h-48 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
        />
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {result ? (
          <p className="text-xs text-fg-muted">
            Imported: {result.created} new, {result.skipped} skipped
            {campaignId ? `, ${result.enrolled} enrolled` : ""}.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
