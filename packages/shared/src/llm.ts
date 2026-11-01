/**
 * A small, dependency-free OpenAI-compatible chat client.
 *
 * Both the api (suggested replies) and the worker (watcher drafts)
 * use this. Moving it to shared keeps the provider request shape in
 * one place and lets either side create its own client from env.
 */

const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_TEMPERATURE = 0.4;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  content: string;
  ok: boolean;
  error?: string;
  model: string;
  latencyMs: number;
  finishReason?: string;
  usage?: ChatUsage;
}

export interface ChatOptions {
  /** Model id. Falls back to the client's default model. */
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** AbortSignal from the caller. */
  signal?: AbortSignal;
  /** Retry once if the model returns reasoning only. Default true. */
  retryOnEmpty?: boolean;
  /** Ask for a JSON object. */
  json?: boolean;
}

export interface ChatClientConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ChatClient {
  chat(options: ChatOptions): Promise<ChatResult>;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, "");
}

function extractError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Not JSON, return the raw text clipped.
  }
  return body.trim().slice(0, 240);
}

function chatMessageContent(raw: unknown): {
  content: string;
  reasoning?: string;
} {
  const message = raw as
    | { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }
    | null;
  if (!message) return { content: "" };

  return {
    content: (message.content ?? "").trim(),
    reasoning: (message.reasoning ?? message.reasoning_content ?? "").trim() || undefined,
  };
}

async function postOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  options: ChatOptions,
  maxTokens: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{
  response: Response;
  content: string;
  reasoning?: string;
  finishReason?: string;
  usage?: ChatUsage;
  error?: string;
}> {
  const started = Date.now();
  const response = await fetch(`${stripTrailingSlash(baseUrl)}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: maxTokens,
      stream: false,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      response,
      content: "",
      latencyMs: 0,
      error: `${response.status} ${extractError(body)}`.trim(),
    } as never;
  }

  const body = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        reasoning?: string | null;
        reasoning_content?: string | null;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const choice = body.choices?.[0];
  const { content, reasoning } = chatMessageContent(choice?.message);

  const result = {
    response,
    content,
    reasoning,
    finishReason: choice?.finish_reason,
    usage: body.usage
      ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
        }
      : undefined,
    latencyMs,
  };

  return result;
}

export function createChatClient(config: ChatClientConfig): ChatClient {
  const baseMaxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const baseTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async chat(options: ChatOptions): Promise<ChatResult> {
      const model = options.model ?? config.defaultModel ?? "";
      const apiKey = config.apiKey;
      const baseUrl = config.baseUrl;

      if (!apiKey.trim()) {
        return {
          content: "",
          ok: false,
          error: "no api key configured",
          model,
          latencyMs: 0,
        };
      }

      if (!model.trim()) {
        return {
          content: "",
          ok: false,
          error: "no model configured",
          model,
          latencyMs: 0,
        };
      }

      const maxTokens = options.maxTokens ?? baseMaxTokens;
      const timeoutMs = options.timeoutMs ?? baseTimeout;

      const started = Date.now();
      let result = await postOnce(baseUrl, apiKey, model, options, maxTokens, timeoutMs, options.signal);

      let reasoning = result.reasoning;
      let finishReason = result.finishReason;
      let usage = result.usage;
      let error = result.error;
      let content = result.content;
      const firstLatency = Date.now() - started;
      let latencyMs = firstLatency;

      // Reasoning models can spend the whole token budget thinking and
      // return an empty final message. When that happens, retry once with
      // a stricter "final answer only" instruction and more room.
      const retryOnEmpty = options.retryOnEmpty ?? true;
      if (retryOnEmpty && !content && reasoning) {
        const retryOptions: ChatOptions = {
          ...options,
          messages: [
            ...options.messages,
            {
              role: "assistant",
              content: reasoning,
            },
            {
              role: "user",
              content:
                "That was your reasoning. Now output only the final reply text, with no reasoning, no code fence and no preamble. If you cannot answer, output an empty reply.",
            },
          ],
          maxTokens: Math.min(maxTokens * 2, 4096),
          retryOnEmpty: false,
        };

        const retry = await postOnce(
          baseUrl,
          apiKey,
          model,
          retryOptions,
          retryOptions.maxTokens!,
          timeoutMs,
          options.signal,
        );
        latencyMs = Date.now() - started;
        content = retry.content || content;
        reasoning = retry.reasoning ?? reasoning;
        finishReason = retry.finishReason ?? finishReason;
        usage = retry.usage ?? usage;
        error = retry.error ?? (content ? undefined : "model produced reasoning but no final text");
      }

      if (error) {
        return {
          content: "",
          ok: false,
          error,
          model,
          latencyMs,
          finishReason,
          usage,
        };
      }

      if (!content) {
        return {
          content: "",
          ok: false,
          error: "model returned no content",
          model,
          latencyMs,
          finishReason,
          usage,
        };
      }

      return {
        content,
        ok: true,
        model,
        latencyMs,
        finishReason,
        usage,
      };
    },
  };
}

/**
 * Suggested reply prompt.
 *
 * Lives in shared so the api and the worker produce identical drafts.
 */
export const SUGGEST_SYSTEM_PROMPT = `You write short, human replies to inbound sales emails for a small B2B team.

Rules:
- Reply to what the sender actually asked. If they asked about pricing, answer about pricing.
- Be brief: three to six sentences, no more.
- Sound like a person, not a template. No "I hope this email finds you well."
- Never invent a price, a date, a discount or a feature. If you do not know a detail, write a placeholder in square brackets, like [your price for 50 seats].
- Do not sign a name. The operator does that.
- Reply with the body only. No subject line, no preamble, no commentary.`;

/** Strips a fenced code block if the model wrapped its answer in one. */
export function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}