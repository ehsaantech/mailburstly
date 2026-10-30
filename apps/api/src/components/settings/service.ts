import {
  DEFAULT_WORKSPACE_SETTINGS,
  type LlmSettings,
  type WorkspaceSettings,
} from "@mailrung/shared";

import type { DbHandle } from "@/db";
import { createSettingsRepository } from "./repository";
import type { UpdateSettingsInput } from "./validator";
import { createChatClient } from "@mailrung/shared";

export interface SettingsServiceDeps {
  db: DbHandle;
  /** The base url of the model api, used to list the available models. */
  llmBaseUrl: string;
  /** The api key for the model provider, read from the environment. */
  llmApiKey?: string;
}

/** A model the operator can pick, as the api reports it. */
export interface LlmModelOption {
  name: string;
  /** True when the model speaks the decision api. */
  decision: boolean;
  /** The capabilities the model advertises. */
  capabilities: string[];
}

const DECISION_MODELS = ["clef", "nimble", "tev", "clef-flash"];

/** True when the model uses the decision api. */
export function isDecisionModel(name: string): boolean {
  return DECISION_MODELS.includes(name.toLowerCase().split(":")[0]!);
}

export function createSettingsService(deps: SettingsServiceDeps) {
  const repository = createSettingsRepository({ db: deps.db.db });

  /**
   * Merges the stored blob over the defaults.
   *
   * The stored blob is jsonb and may be missing keys, hold an older shape,
   * or be empty. Merging over the defaults means a partial row still yields
   * a complete settings object.
   */
  function merge(stored: Record<string, unknown>): WorkspaceSettings {
    const llm = (stored.llm ?? {}) as Partial<LlmSettings>;

    return {
      ...DEFAULT_WORKSPACE_SETTINGS,
      ...stripUndefined(stored),
      llm: {
        ...DEFAULT_WORKSPACE_SETTINGS.llm,
        ...llm,
      },
    };
  }

  return {
    async get(): Promise<WorkspaceSettings> {
      return merge(await repository.current());
    },

    async update(
      input: UpdateSettingsInput,
    ): Promise<WorkspaceSettings> {
      const current = await repository.current();
      const merged = merge(current);

      const next: Record<string, unknown> = { ...current };

      if (input.llm) {
        next.llm = { ...merged.llm, ...input.llm };
      }
      for (const key of [
        "replyRateThreshold",
        "defaultMailboxDailyCap",
        "defaultMinGapSeconds",
        "defaultRandomJitterSeconds",
      ] as const) {
        const value = input[key];
        if (value !== undefined) next[key] = value;
      }

      const saved = await repository.patch(
        await workspaceId(deps.db),
        next,
      );

      return merge(saved);
    },

    /**
     * The models the operator can choose from.
     *
     * Ollama's tag list is public, so this works without a key. If the
     * provider is unreachable the list is empty rather than an error: the
     * dropdown still shows the model currently in use.
     */
    async testWriter(model: string): Promise<{
      ok: boolean;
      model: string;
      draft?: string;
      latencyMs?: number;
      error?: string;
    }> {
      if (isDecisionModel(model)) {
        return { ok: false, model, error: "This is a decision model and cannot draft text." };
      }
      const client = createChatClient({
        baseUrl: deps.llmBaseUrl,
        apiKey: deps.llmApiKey ?? "",
        defaultModel: model,
        maxTokens: 64,
        timeoutMs: 20_000,
      });
      const result = await client.chat({
        model,
        messages: [
          { role: "user", content: "Reply with one short sentence confirming that the drafting model is online." },
        ],
        temperature: 0,
        maxTokens: 64,
        retryOnEmpty: true,
      });
      if (!result.ok) {
        return { ok: false, model, latencyMs: result.latencyMs, error: result.error };
      }
      return {
        ok: true,
        model: result.model,
        draft: result.content,
        latencyMs: result.latencyMs,
      };
    },

    async listModels(): Promise<LlmModelOption[]> {
      try {
        const res = await fetch(
          `${deps.llmBaseUrl.replace(/\/$/, "")}/api/tags`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) return [];

        const body = (await res.json()) as {
          models?: Array<{
            name?: string;
            model?: string;
            capabilities?: string[];
          }>;
        };

        return (body.models ?? [])
          .map((m) => m.name ?? m.model ?? "")
          .filter((name) => name.length > 0)
          .sort()
          .map((name) => ({
            name,
            decision: isDecisionModel(name),
            capabilities: [],
          }));
      } catch {
        return [];
      }
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;

function stripUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The one workspace's id. */
async function workspaceId(db: DbHandle): Promise<string> {
  const rows = await db.db.execute(
    `SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`,
  );
  const first = rows[0] as { id?: string } | undefined;
  return first?.id ?? "";
}
