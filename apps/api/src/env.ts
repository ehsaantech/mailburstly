import { z } from "zod";

/**
 * Environment, validated once at boot.
 *
 * Every value needs a sane local default so `bun run dev` works with no .env
 * file, but production is strict: a placeholder secret fails to boot rather
 * than silently accepting the weak one.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  DATABASE_URL: z
    .string()
    .default(
      "postgres://mailrung:change-me-postgres@localhost:5432/mailrung",
    ),

  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters")
    .default("dev-only-session-secret-please-replace-with-32-plus-bytes"),

  /** Session lifetime in days. */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(30),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  PUBLIC_URL: z.string().default("http://localhost:8080"),

  EMAILENGINE_API_URL: z.string().default("http://localhost:3003"),
  EMAILENGINE_SECRET: z.string().default(""),

  /**
   * EmailEngine API token (from `emailengine tokens issue`). Used as the
   * Bearer token for all EmailEngine REST API calls. Falls back to
   * EMAILENGINE_SECRET for backward compat, but the secret is for the admin
   * UI session, not the API.
   */
  EMAILENGINE_API_TOKEN: z.string().default(""),

  /**
   * EmailEngine's internal OAuth2 application IDs (from EmailEngine's
   * Integrations > OAuth2 Apps). These are NOT the Google/Microsoft client
   * ids — they are EmailEngine's own IDs for the OAuth apps you configured
   * in its admin UI. Leave blank to show the provider selection screen.
   */
  GOOGLE_OAUTH_APP_ID: z.string().default(""),
  MICROSOFT_OAUTH_APP_ID: z.string().default(""),

  /**
   * The base url of the model api. Ollama's cloud is "https://ollama.com";
   * a local Ollama server is "http://localhost:11434".
   *
   * The api reads it to list the models the operator can choose from in
   * Settings. The key itself never reaches this process: it stays in the
   * worker, which is the only component that calls the model.
   */
  LLM_BASE_URL: z.string().default("https://ollama.com"),

  /**
   * The dispatcher, which owns the template renderer.
   *
   * The api asks it to render a preview so that a preview and the real
   * send can never disagree.
   */
  DISPATCHER_URL: z.string().default("http://dispatcher:8090"),

  /**
   * The model api.
   *
   * The api uses it to write, not to label — a suggested reply. The
   * classifier lives in the worker.
   */
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("gpt-oss:20b"),
});

const DEV_SECRET = "dev-only-session-secret-please-replace-with-32-plus-bytes";

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const summary = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment — ${summary}`);
}

let env = parsed.data;

if (env.NODE_ENV === "production" && env.SESSION_SECRET === DEV_SECRET) {
  throw new Error(
    "Refusing to start in production with the development SESSION_SECRET. " +
      "Set a real 32+ character secret.",
  );
}

/* Re-freeze with sensible derived defaults so callers cannot mutate it. */
env = Object.freeze(env) as typeof env;

export { env };
export type Env = typeof env;

/** Whether this process may serve cross-origin dev clients (Vite on :5173). */
export const allowedOrigins = new Set(
  env.NODE_ENV === "production"
    ? [env.PUBLIC_URL]
    : [env.PUBLIC_URL, "http://localhost:5173"],
);