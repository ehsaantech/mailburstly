/**
 * The Ollama client.
 *
 * Ollama's cloud exposes two surfaces and this speaks both:
 *
 *   /v1/chat/completions — the OpenAI-compatible endpoint. Works with every
 *     chat model, needs a prompt and returns free-form text.
 *
 *   /v1/systemone — the decision endpoint. Built for exactly this job:
 *     classify text into labelled criteria and get back a probability for
 *     each one plus a concentration score. No prompt engineering, and the
 *     output tokens are essentially free.
 *
 * The decision path is used when the configured model is a decision model
 * (`clef`, `nimble`, `tev`); the chat path handles everything else.
 *
 * @see https://docs.ollama.com/api/systemone
 * @see https://docs.ollama.com/api/openai-compatibility
 */

import type { Classification, Interest } from "./types";

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

export interface OllamaConfig {
  apiKey: string;
  /** "https://ollama.com" for the cloud, "http://localhost:11434" for local. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/* -------------------------------------------------------------------------- */
/* Decision models                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The models trained for the System One decision API.
 *
 * A model that is not in this list uses the chat path, so pointing
 * `LLM_MODEL` at a general chat model still works.
 */
const DECISION_MODELS = ["clef", "nimble", "tev", "clef-flash"];

/** True when the model speaks the decision API. */
export function isDecisionModel(model: string): boolean {
  const name = model.toLowerCase().split(":")[0]!;
  return DECISION_MODELS.includes(name);
}

/* -------------------------------------------------------------------------- */
/* The criteria the model is asked to choose between                           */
/* -------------------------------------------------------------------------- */

const INTEREST_CRITERIA: Record<Interest, string> = {
  positive:
    "The sender wants to hear more, is asking about price, a demo, a trial or a meeting, or says the offer sounds good.",
  negative:
    "The sender declines, says they are not interested, no longer need this, or asks to stop being contacted.",
  neutral:
    "The sender acknowledges the message without expressing interest or declining, or the message is about something else entirely.",
  question:
    "The sender asks for information or clarification but has not shown any intent to buy or to decline.",
};

const OPPORTUNITY_TRUE =
  "The sender asked about pricing, a quote, a demo, a trial, a meeting or a call, a contract, a budget, or procurement.";
const OPPORTUNITY_FALSE =
  "The sender did not express any buying intent; they declined, asked a general question, or sent something unrelated.";

/* -------------------------------------------------------------------------- */
/* Response shapes                                                             */
/* -------------------------------------------------------------------------- */

interface SystemOneChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

interface SystemOneNoulAnswer {
  type: "noul";
  noul: number;
}

interface SystemOneResponse {
  model?: string;
  answers?: Record<
    string,
    SystemOneChoiceAnswer | SystemOneNoulAnswer | { type?: string }
  >;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/* -------------------------------------------------------------------------- */
/* Result                                                                      */
/* -------------------------------------------------------------------------- */

export interface LlmResult {
  classification: Classification;
  inputTokens: number;
  outputTokens: number;
  /** The raw model reply, kept for the log when something looks wrong. */
  raw: string;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

const INTERESTS: Interest[] = ["positive", "negative", "neutral", "question"];

/**
 * Reads the decision API's answer.
 *
 * Kept separate from the request so it can be unit-tested against a
 * recorded response without a network.
 */
export function parseSystemOneResponse(
  body: SystemOneResponse,
): { interest: Interest; confidence: number; isOpportunity: boolean } | null {
  const answers = body.answers;
  if (!answers) return null;

  const interestAnswer = answers.interest as SystemOneChoiceAnswer | undefined;
  if (!interestAnswer || interestAnswer.type !== "choice") return null;

  const choice = interestAnswer.choice as Interest;
  if (!INTERESTS.includes(choice)) return null;

  const opportunityAnswer = answers.opportunity as SystemOneNoulAnswer | undefined;
  const isOpportunity =
    opportunityAnswer?.type === "noul" ? opportunityAnswer.noul >= 0.5 : false;

  return {
    interest: choice,
    // The concentration score. It is not a calibrated correctness score,
    // but it is a real one — unlike a number a chat model invents.
    confidence: clamp01(interestAnswer.confidence),
    isOpportunity,
  };
}

/**
 * Reads the chat path's JSON answer.
 *
 * The model is asked for JSON and nothing else, but a model can still wrap
 * it in prose, so the first `{…}` block is extracted. A model that returns
 * something unparseable yields null, and the caller falls back to the rules.
 */
export function parseChatResponse(
  content: string,
): { interest: Interest; confidence: number; isOpportunity: boolean; summary: string | null } | null {
  const json = extractJsonObject(content);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const interest = obj.interest as Interest;
  if (!INTERESTS.includes(interest)) return null;

  const confidence =
    typeof obj.confidence === "number" ? clamp01(obj.confidence) : 0.5;

  const isOpportunity =
    obj.isOpportunity === true ||
    (typeof obj.isOpportunity === "string" &&
      obj.isOpportunity.toLowerCase() === "true");

  const summary =
    typeof obj.summary === "string" && obj.summary.trim().length > 0
      ? obj.summary.trim().slice(0, 300)
      : null;

  return { interest, confidence, isOpportunity, summary };
}

/** The first balanced `{…}` block in a string. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

/** The instruction for the chat path. */
export const CHAT_SYSTEM_PROMPT = `You classify replies to cold sales emails for a small B2B team.

Reply with a single JSON object and nothing else:
{"interest":"positive|negative|neutral|question","confidence":0.0-1.0,"isOpportunity":true|false,"summary":"one short sentence"}

Rules:
- "positive": the sender wants to hear more, asks about price, a demo, a trial, a meeting, or says the offer sounds good.
- "negative": the sender declines, says they are not interested, no longer need this, or asks to stop being contacted.
- "question": the sender asks for information or clarification but shows no intent to buy or decline.
- "neutral": anything else, including acknowledgements and messages about an unrelated subject.
- "isOpportunity": true only when the sender shows buying intent (pricing, quote, demo, trial, meeting, contract, budget, procurement).
- "confidence": how sure you are. Use a low value when the message is ambiguous.
- "summary": one short sentence, in your own words, saying what the sender wants. Empty string if there is nothing to say.`;

/** The state handed to the decision model: the reply, as it arrived. */
export function buildDecisionState(input: {
  subject: string | null;
  body: string;
  originalSubject?: string | null;
}): string {
  const parts: string[] = [];

  if (input.originalSubject) {
    parts.push(`The email we sent had the subject: ${input.originalSubject}`);
  }
  if (input.subject) parts.push(`Their reply has the subject: ${input.subject}`);
  parts.push("");
  parts.push(input.body);

  return parts.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export function createOllamaClient(config: OllamaConfig) {
  const base = config.baseUrl.replace(/\/$/, "");

  async function post(path: string, payload: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      return await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** True when this client can answer. */
    get enabled(): boolean {
      return config.apiKey.trim().length > 0;
    },

    /** The decision path: one request, labelled answers with probabilities. */
    async classifyByDecision(input: {
      subject: string | null;
      body: string;
      originalSubject?: string | null;
    }): Promise<LlmResult | null> {
      const res = await post("/v1/systemone", {
        model: config.model,
        state: buildDecisionState(input),
        questions: {
          interest: {
            type: "choice",
            instructions:
              "How interested is the sender in what we offered?",
            criteria: INTEREST_CRITERIA,
          },
          opportunity: {
            type: "noul",
            instructions:
              "Does the sender show a buying signal worth following up on?",
            criteria: {
              false: OPPORTUNITY_FALSE,
              true: OPPORTUNITY_TRUE,
            },
          },
        },
      });

      if (!res.ok) {
        throw new Error(
          `ollama systemone returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
        );
      }

      const body = (await res.json()) as SystemOneResponse;
      const parsed = parseSystemOneResponse(body);
      if (!parsed) return null;

      return {
        classification: {
          interest: parsed.interest,
          confidence: parsed.confidence,
          isOpportunity: parsed.isOpportunity,
          summary: null,
          source: "llm",
        },
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        raw: JSON.stringify(body.answers ?? {}),
      };
    },

    /** The chat path: works with any chat model. */
    async classifyByChat(input: {
      subject: string | null;
      body: string;
      originalSubject?: string | null;
    }): Promise<LlmResult | null> {
      const res = await post("/v1/chat/completions", {
        model: config.model,
        stream: false,
        temperature: 0,
        messages: [
          { role: "system", content: CHAT_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildDecisionState(input),
          },
        ],
        response_format: { type: "json_object" },
      });

      if (!res.ok) {
        throw new Error(
          `ollama chat returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
        );
      }

      const body = (await res.json()) as ChatCompletionResponse;
      const content = body.choices?.[0]?.message?.content ?? "";
      const parsed = parseChatResponse(content);
      if (!parsed) return null;

      return {
        classification: {
          interest: parsed.interest,
          confidence: parsed.confidence,
          isOpportunity: parsed.isOpportunity,
          summary: parsed.summary,
          source: "llm",
        },
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        raw: content.slice(0, 1000),
      };
    },

    /** The right path for the configured model. */
    async classify(input: {
      subject: string | null;
      body: string;
      originalSubject?: string | null;
    }): Promise<LlmResult | null> {
      if (isDecisionModel(config.model)) {
        return this.classifyByDecision(input);
      }
      return this.classifyByChat(input);
    },
  };
}

export type OllamaClient = ReturnType<typeof createOllamaClient>;
