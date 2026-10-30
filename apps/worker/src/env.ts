import { z } from "zod";

/**
 * A boolean that reads the way an operator writes it.
 *
 * `z.coerce.boolean()` is wrong here: it turns the string "false" into
 * `true`, because any non-empty string is truthy.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean"
      ? value
      : ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()),
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DATABASE_URL: z.string().default("postgres://mailrung:change-me-postgres@localhost:5433/mailrung"),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MAILCORE_API_URL: z.string().default("http://localhost:3003"),
  MAILCORE_API_TOKEN: z.string().default(""),
  /**
   * mailcore's `serviceSecret` setting. Webhooks are signed with
   * HMAC-SHA256 over the raw body using this value, and the header
   * `X-EE-Wh-Signature` carries the result.
   */
  MAILCORE_WEBHOOK_SECRET: z.string().default(""),
  WORKER_WEBHOOK_URL: z.string().default("http://worker:3002/webhooks/mailcore"),
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
  /**
   * Alerting.
   *
   * The recipients live in the database (`alert_recipients`), not here —
   * this only decides whether alerts can be sent at all, and from where.
   *
   * Resend is used deliberately: it is a separate provider from the mail
   * gateway, so an alert still goes out when the gateway is what broke.
   */
  RESEND_API_KEY: z.string().default(""),
  ALERT_FROM_EMAIL: z.string().default("alerts@mail.ehsaanlabs.com"),
  ALERT_ENABLED: booleanish.default(true),
  /** How long the same kind of failure stays quiet before it is mailed again. */
  ALERT_COOLDOWN_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300_000),
  /** Hard cap on alert emails per hour. */
  ALERT_MAX_PER_HOUR: z.coerce.number().int().min(1).max(200).default(20),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment — ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
}

export const env = Object.freeze(parsed.data) as typeof parsed.data;
export type Env = typeof env;