import { useEffect, useState } from "react";
import { KeyRound, Plus, Shield, Sparkles, Users } from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Avatar } from "@/components/ui/Stat";
import { users } from "@/mocks/data";
import { initials } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";


/* -------------------------------------------------------------------------- */
/* Reply classification card — wired to the real api                           */
/* -------------------------------------------------------------------------- */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface LlmSettings {
  model: string;
  minConfidence: number;
  enabled: boolean;
}

interface LlmModel {
  name: string;
  decision: boolean;
}

function LlmCard() {
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api.get<{ data: { settings: { llm: LlmSettings } } }>("/settings"),
  });

  const models = useQuery({
    queryKey: ["settings", "llm-models"],
    queryFn: () =>
      api.get<{ data: { items: LlmModel[] } }>("/settings/llm-models"),
  });

  const llm = settings.data?.data?.settings?.llm;

  const [model, setModel] = useState(llm?.model ?? "clef:27b");
  const [confidence, setConfidence] = useState(
    (llm?.minConfidence ?? 0.7).toFixed(2),
  );
  const [enabled, setEnabled] = useState(llm?.enabled ?? true);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Adopt the stored settings once they load. After that the form belongs
  // to the user, so a background refetch never overwrites what they typed.
  useEffect(() => {
    if (hydrated || !llm) return;
    setModel(llm.model);
    setConfidence(llm.minConfidence.toFixed(2));
    setEnabled(llm.enabled);
    setHydrated(true);
  }, [hydrated, llm]);

  const save = useMutation({
    mutationFn: (input: LlmSettings) =>
      api.patch<{ data: { settings: { llm: LlmSettings } } }>("/settings", {
        llm: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSavedAt(Date.now());
    },
  });

  const handleSave = () => {
    save.mutate({
      model,
      minConfidence: Number(confidence),
      enabled,
    });
  };

  const modelList = models.data?.data?.items ?? [];
  const currentModel = modelList.find((m) => m.name === model);

  return (
    <>
      <Switch
        id="ai-classify"
        label="Classify inbound replies"
        description="Tag replies with a lead status automatically."
        checked={enabled}
        onChange={setEnabled}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Model" htmlFor="model">
          <Select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={models.isLoading}
          >
            {modelList.length === 0 ? (
              <option value={model}>{model}</option>
            ) : (
              modelList.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.decision ? "  (decision model)" : ""}
                </option>
              ))
            )}
          </Select>
        </Field>
        <Field label="Min confidence" htmlFor="conf">
          <Select
            id="conf"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
          >
            <option value="0.50">0.50</option>
            <option value="0.60">0.60</option>
            <option value="0.70">0.70</option>
            <option value="0.80">0.80</option>
            <option value="0.90">0.90</option>
          </Select>
        </Field>
      </div>

      {currentModel?.decision ? (
        <p className="text-[11px] leading-snug text-fg-muted">
          A decision model returns a probability per label and a real
          confidence score. There is no output-token cost, and no prompt
          engineering.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-fg-muted">
          A chat model returns free-form JSON. Its self-reported confidence
          is not calibrated, so a confident rule result can override it.
        </p>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/50 p-2.5">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <p className="text-[11px] leading-snug text-fg-muted">
          A reply below the confidence threshold is left unlabelled for
          human review. It is never silently marked{" "}
          <span className="font-medium text-fg">Not Interested</span>. The
          API key is set in the environment, not here.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        {savedAt ? (
          <span className="text-[11px] text-success">Saved</span>
        ) : null}
      </div>
    </>
  );
}


export function SettingsPage() {
  const { prefs, setPrefs } = usePreferences();
  const [tz, setTz] = useState("Asia/Karachi");
  const [openTracking, setOpenTracking] = useState(true);
  const [linkTracking, setLinkTracking] = useState(true);
  const [textOnly, setTextOnly] = useState(false);
  const [verifyOnImport, setVerifyOnImport] = useState(true);

  return (
    <Page
      title="Settings"
      description="Workspace defaults. Campaign settings inherit these unless overridden."
      actions={
        <Button variant="primary" size="sm">
          Save changes
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Workspace */}
        <Card>
          <CardHeader
            title="Workspace"
            description="Identity, timezone and reporting benchmarks"
            actions={<Shield className="h-4 w-4 text-fg-subtle" />}
          />
          <CardBody className="space-y-4">
            <Field label="Workspace name" htmlFor="ws-name">
              <Input id="ws-name" defaultValue="Ehsaan Tech" />
            </Field>
            <div>
              <label
                htmlFor="ws-tz"
                className="mb-1.5 block text-xs font-medium text-fg-muted"
              >
                Timezone
              </label>
              <Select
                id="ws-tz"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
              >
                <option value="Asia/Karachi">Asia/Karachi (PKT, UTC+5)</option>
                <option value="America/New_York">America/New_York (ET)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="UTC">UTC</option>
              </Select>
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                Used for daily send limits and report boundaries. Reporting is
                stored in UTC internally.
              </p>
            </div>

            <div>
              <label
                htmlFor="ws-benchmark"
                className="mb-1.5 block text-xs font-medium text-fg-muted"
              >
                Reply-rate benchmark
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="ws-benchmark"
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={prefs.replyRateThreshold}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0 && next <= 100) {
                      setPrefs({ replyRateThreshold: next });
                    }
                  }}
                  className="w-24"
                />
                <span className="text-sm text-fg-muted">%</span>
              </div>
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                Campaigns at or above this reply rate are highlighted green in
                every table. Cold email typically lands between 2% and 6%.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Sending defaults */}
        <Card>
          <CardHeader
            title="Sending defaults"
            description="Applied to new campaigns"
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Per-mailbox daily cap" htmlFor="cap">
                <Input id="cap" type="number" defaultValue={30} min={10} max={50} />
              </Field>
              <Field label="Min gap (minutes)" htmlFor="gap">
                <Input id="gap" type="number" defaultValue={9} min={1} max={60} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Random jitter (minutes)" htmlFor="jitter">
                <Input id="jitter" type="number" defaultValue={5} min={0} max={30} />
              </Field>
              <Field label="Max new leads / day" htmlFor="maxleads">
                <Input id="maxleads" type="number" defaultValue={120} min={0} />
              </Field>
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <Switch
                id="def-open"
                label="Open tracking"
                description="On unless a campaign opts out."
                checked={openTracking}
                onChange={setOpenTracking}
              />
              <Switch
                id="def-link"
                label="Link tracking"
                checked={linkTracking}
                onChange={setLinkTracking}
              />
              <Switch
                id="def-text"
                label="Text-only by default"
                description="No HTML, no images, no tracking pixel."
                checked={textOnly}
                onChange={setTextOnly}
              />
            </div>
          </CardBody>
        </Card>

        {/* AI */}
        <Card>
          <CardHeader
            title="AI automation"
            description="Reply classification and reply drafting"
            actions={<Sparkles className="h-4 w-4 text-fg-subtle" />}
          />
          <CardBody className="space-y-4">
            {/* ---- Reply classification ---- */}
            <LlmCard />
          </CardBody>
        </Card>

        {/* Verification */}
        <Card>
          <CardHeader
            title="Email verification"
            description="Keep invalid addresses out of the pool"
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider" htmlFor="verif-provider">
                <Select id="verif-provider" defaultValue="neverbounce">
                  <option value="neverbounce">NeverBounce</option>
                  <option value="zerobounce">ZeroBounce</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              <Field label="Daily cap" htmlFor="verif-cap">
                <Input id="verif-cap" type="number" defaultValue={5000} />
              </Field>
            </div>
            <Field label="API key" htmlFor="verif-key">
              <Input
                id="verif-key"
                type="password"
                placeholder="••••••••••••••••"
              />
            </Field>
            <Switch
              id="verif-import"
              label="Verify on import"
              description="Runs in the background after each upload. Results cached 30 days."
              checked={verifyOnImport}
              onChange={setVerifyOnImport}
            />
          </CardBody>
        </Card>
      </div>

      {/* Users */}
      <Card className="mt-4">
        <CardHeader
          title="Team"
          description="Internal tool — an admin adds a user by email. No invitations or SSO."
          actions={
            <Button variant="secondary" size="sm">
              <Plus className="h-3.5 w-3.5" />
              Add user
            </Button>
          }
        />
        <CardBody className="p-0">
          <div className="divide-y divide-[var(--border)]">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar initials={initials(u.name)} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">
                      {u.name}
                    </p>
                    <p className="truncate text-xs text-fg-subtle">
                      {u.email}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={u.role === "admin" ? "accent" : "neutral"}>
                    {u.role}
                  </Badge>
                  <Button variant="ghost" size="sm">
                    Manage
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-fg-subtle">
        <Users className="h-3.5 w-3.5" />
        Internal workspace · 3 users · no billing or seat limits
      </div>
    </Page>
  );
}
