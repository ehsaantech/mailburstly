import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Plus, Send, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { api } from "@/lib/api";

interface AlertRecipient {
  id: string;
  email: string;
  name: string | null;
  severity: "error" | "warning";
  enabled: boolean;
  createdAt: string;
}

const SEVERITY_HELP: Record<AlertRecipient["severity"], string> = {
  error: "Errors only — when something is broken.",
  warning: "Everything — errors and warnings.",
};

/**
 * Who gets told when something breaks.
 *
 * The list lives in the database, so adding a second address is a row, not
 * a redeploy. The severity decides how loud an alert has to be before this
 * address hears about it.
 */
export function AlertRecipientsCard() {
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [severity, setSeverity] = useState<AlertRecipient["severity"]>("error");
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );

  const recipients = useQuery({
    queryKey: ["alert-recipients"],
    queryFn: () =>
      api.get<{ data: { items: AlertRecipient[] } }>("/alert-recipients"),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["alert-recipients"] });

  const add = useMutation({
    mutationFn: (input: { email: string; severity: AlertRecipient["severity"] }) =>
      api.post("/alert-recipients", input),
    onSuccess: () => {
      setEmail("");
      setNotice(null);
      void refresh();
    },
    onError: (error) =>
      setNotice({
        tone: "bad",
        text: error instanceof Error ? error.message : "Could not add it.",
      }),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      enabled?: boolean;
      severity?: AlertRecipient["severity"];
    }) => api.patch(`/alert-recipients/${id}`, body),
    onSuccess: () => void refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/alert-recipients/${id}`),
    onSuccess: () => void refresh(),
  });

  const test = useMutation({
    mutationFn: (id: string) =>
      api.post<{ data: { delivered: boolean } }>(
        `/alert-recipients/${id}/test`,
      ),
    onSuccess: (result) =>
      setNotice({
        tone: result.data.delivered ? "ok" : "bad",
        text: result.data.delivered
          ? "Test alert sent. Check that inbox."
          : "The test alert could not be sent.",
      }),
    onError: (error) =>
      setNotice({
        tone: "bad",
        text: error instanceof Error ? error.message : "The test alert could not be sent.",
      }),
  });

  const items = recipients.data?.data?.items ?? [];

  const submit = () => {
    const value = email.trim();
    if (!value) return;
    add.mutate({ email: value, severity });
  };

  return (
    <Card className="mt-4">
      <CardHeader
        title="Alert recipients"
        description="Who gets an email when something breaks — above all when an email fails to send."
        actions={<BellRing className="h-4 w-4 text-fg-subtle" />}
      />
      <CardBody className="space-y-4">
        {items.length === 0 ? (
          <p className="text-xs text-fg-subtle">
            No one is listening yet. Without a recipient, failures are only
            written to the log.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {items.map((recipient) => (
              <div
                key={recipient.id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">
                    {recipient.name ? (
                      <span className="text-fg-muted">{recipient.name} · </span>
                    ) : null}
                    {recipient.email}
                  </p>
                  <p className="truncate text-xs text-fg-subtle">
                    {SEVERITY_HELP[recipient.severity]}
                  </p>
                </div>

                <Badge tone={recipient.severity === "error" ? "danger" : "warning"}>
                  {recipient.severity === "error" ? "Errors" : "Everything"}
                </Badge>

                <Select
                  aria-label="Severity"
                  value={recipient.severity}
                  onChange={(e) =>
                    update.mutate({
                      id: recipient.id,
                      severity: e.target.value as AlertRecipient["severity"],
                    })
                  }
                  className="h-8 w-32"
                >
                  <option value="error">Errors only</option>
                  <option value="warning">Everything</option>
                </Select>

                <Switch
                  checked={recipient.enabled}
                  onChange={(next) =>
                    update.mutate({ id: recipient.id, enabled: next })
                  }
                  label={recipient.enabled ? "Enabled" : "Disabled"}
                />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => test.mutate(recipient.id)}
                  disabled={test.isPending}
                >
                  <Send className="h-3.5 w-3.5" />
                  Test
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(recipient.id)}
                  disabled={remove.isPending}
                  aria-label={`Remove ${recipient.email}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="min-w-56 flex-1">
            <Field label="Add an address" htmlFor="alert-email">
              <Input
                id="alert-email"
                type="email"
                placeholder="someone@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </Field>
          </div>
          <Field label="Severity" htmlFor="alert-severity">
            <Select
              id="alert-severity"
              value={severity}
              onChange={(e) =>
                setSeverity(e.target.value as AlertRecipient["severity"])
              }
              className="w-36"
            >
              <option value="error">Errors only</option>
              <option value="warning">Everything</option>
            </Select>
          </Field>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            loading={add.isPending}
            disabled={email.trim().length === 0}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        {notice ? (
          <p
            className={
              notice.tone === "ok"
                ? "text-[11px] text-success"
                : "text-[11px] text-danger"
            }
          >
            {notice.text}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
