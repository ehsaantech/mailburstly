/**
 * Backwards-compatible chat handle for the api.
 *
 * The provider client lives in @mailrung/shared now; the only job here is
 * to bind the environment to it and re-export the names the rest of the app
 * already imports.
 */

import { env } from "@/env";
import {
  createChatClient,
  stripFence,
  SUGGEST_SYSTEM_PROMPT,
  type ChatClient,
  type ChatResult,
  type ChatMessage,
} from "@mailrung/shared";

export { stripFence, SUGGEST_SYSTEM_PROMPT };

const client: ChatClient = createChatClient({
  baseUrl: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
  defaultModel: env.LLM_MODEL,
  maxTokens: 600,
  timeoutMs: 45_000,
});

/**
 * Legacy single-function form. New code should prefer creating a client via
 * createChatClient so the base URL/key can vary, but this keeps the existing
 * inbox suggest call path unchanged.
 */
export async function chat(options: {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  json?: boolean;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  return client.chat({
    ...options,
    retryOnEmpty: true,
  });
}

export type { ChatResult, ChatMessage };