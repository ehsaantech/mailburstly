/**
 * Environment for mailcore, validated once at boot.
 *
 * mailcore is the mail gateway: it holds OAuth tokens, speaks IMAP/SMTP/Gmail
 * API/Graph, and hands the worker its events. It talks to the same Postgres
 * as the rest of the app — the `mail_*` tables are its own, the rest is
 * shared.
 */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  MAILCORE_PORT: z.coerce.number().int().min(1).max(65535).default(3004),

  /**
   * The public address of this service. It is what the OAuth redirect points
   * at, what a tracking pixel is loaded from, and where the browser lands
   * after consent — so it must be the address the outside world can reach,
   * not the container address.
   */
  MAILCORE_PUBLIC_URL: z.string().default("http://localhost:8080"),

  DATABASE_URL: z
    .string()
    .default("postgres://mailrung:change-me-postgres@localhost:5432/mailrung"),

  /** Bearer token for the compat API. Empty disables the check (dev only). */
  MAILCORE_API_TOKEN: z.string().default(""),

  /** Where the worker wants its mail events. */
  MAILCORE_WEBHOOK_URL: z
    .string()
    .default("http://worker:3002/webhooks/mailcore"),

  /** HMAC key the worker verifies `X-EE-Wh-Signature` with. */
  MAILCORE_WEBHOOK_SECRET: z.string().default(""),

  /** 32-byte key (base64) that encrypts OAuth tokens at rest. */
  MAILCORE_ENCRYPTION_KEY: z.string().default(""),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_CLIENT_ID: z.string().default(""),
  MICROSOFT_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_TENANT: z.string().default("common"),

  /** Seconds between inbound sync passes. */
  MAILCORE_SYNC_INTERVAL: z.coerce.number().int().min(5).max(3600).default(30),

  /** How many days of history the first sync imports. */
  MAILCORE_INITIAL_SYNC_DAYS: z.coerce.number().int().min(1).max(90).default(14),

});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const summary = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment — ${summary}`);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
