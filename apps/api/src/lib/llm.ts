/**
 * A small Ollama client for the api.
 *
 * The worker has the classifier; the api has the things that need a
 * language model to *write* rather than to label — today, a suggested
 * reply. Both talk to the same provider with the same key.
 */

import { env } from "@/env";

const BASE = env.LLM_BASE_URL.replace(/\/$/, "");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object. */
  json?: boolean;
}

export interface ChatResult {
  content: string;
  ok: boolean;
  error?: string;
}

/**
 * Sends a chat completion.
 *
 * A failure returns an empty result rather than throwing: a missing
 * suggestion is a nuisance, a 500 in the inbox is a broken inbox.
 */
export async function chat(options: ChatOptions): Promise<ChatResult> {
  if (!env.LLM_API_KEY.trim()) {
    return { content: "", ok: false, error: "no api key" };
  }

  try {
    const response = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model ?? env.LLM_MODEL,
        messages: options.messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 600,
        stream: false,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return {
        content: "",
        ok: false,
        error: `model returned ${response.status}`,
      };
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return {
      content: body.choices?.[0]?.message?.content ?? "",
      ok: true,
    };
  } catch (error) {
    return {
      content: "",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The instruction the suggested-reply prompt uses. */
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
