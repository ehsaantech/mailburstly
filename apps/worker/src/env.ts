import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DATABASE_URL: z.string().default("postgres://mailrung:change-me-postgres@localhost:5433/mailrung"),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  EMAILENGINE_API_URL: z.string().default("http://localhost:3003"),
  EMAILENGINE_API_TOKEN: z.string().default(""),
  EMAILENGINE_SECRET: z.string().default(""),
  EMAILENGINE_WEBHOOK_SECRET: z.string().default("change-me-webhook-secret"),
  /**
   * EmailEngine's `serviceSecret` setting. Webhooks are signed with
   * HMAC-SHA256 over the raw body using this value, and the header
   * `X-EE-Wh-Signature` carries the result.
   */
  EMAILENGINE_SERVICE_SECRET: z.string().default(""),
  WORKER_WEBHOOK_URL: z.string().default("http://worker:3002/webhooks/emailengine"),
  LLM_PROVIDER: z.enum(["ollama", "anthropic", "openai"]).default("ollama"),
  LLM_API_KEY: z.string().default(""),
  /**
   * The base url of the model api. Ollama's cloud is
   * "https://ollama.com"; a local Ollama server is
   * "http://localhost:11434".
   */
  LLM_BASE_URL: z.string().default("https://ollama.com"),
  /**
   * The model that classifies replies.
   *
   * A decision model ("clef", "nimble", "tev") uses Ollama's /v1/systemone
   * endpoint, which returns labelled probabilities and a real confidence
   * score. Any other model uses /v1/chat/completions.
   */
  LLM_MODEL: z.string().default("clef:27b"),
  LLM_CLASSIFY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  /** How long to wait for the model before giving up and using the rules. */
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  VERIFICATION_PROVIDER: z.enum(["neverbounce", "zerobounce", "none"]).default("neverbounce"),
  VERIFICATION_API_KEY: z.string().default(""),
  VERIFICATION_DAILY_CAP: z.coerce.number().int().min(0).default(5000),
  SCHEDULER_TICK_MS: z.coerce.number().int().min(1000).default(30_000),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(5000).default(300_000),
  /** How often the activity log is rolled up into daily statistics. */
  AGGREGATION_INTERVAL_MS: z.coerce.number().int().min(10_000).default(300_000),
  /** How often due subsequence steps are queued for sending. */
  SUBSEQUENCE_TICK_MS: z.coerce.number().int().min(5_000).default(30_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment — ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
}

export const env = Object.freeze(parsed.data) as typeof parsed.data;
export type Env = typeof env;