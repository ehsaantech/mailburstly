/**
 * Postgres access for mailcore.
 *
 * mailcore owns the `mail_*` tables and shares the database with the rest of
 * the app. The tables are created here rather than through drizzle: they are
 * this service's private storage, and the shape is stable.
 */
import postgres from "postgres";

import { env } from "./env";

const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  max_lifetime: 60 * 30,
  prepare: true,
  onnotice: () => {},
});

const schema = `
CREATE TABLE IF NOT EXISTS mail_accounts (
  id                text PRIMARY KEY,
  email             text NOT NULL,
  display_name      text,
  provider          text NOT NULL,
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL,
  scopes            text[] NOT NULL DEFAULT '{}',
  access_token_enc  text,
  refresh_token_enc text NOT NULL,
  key_version       int  NOT NULL DEFAULT 1,
  access_expires_at timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mail_oauth_states (
  state         text PRIMARY KEY,
  account_id    text NOT NULL,
  provider      text NOT NULL,
  code_verifier text NOT NULL,
  redirect_to   text NOT NULL,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz
);
CREATE TABLE IF NOT EXISTS mail_sync_state (
  account_id   text PRIMARY KEY REFERENCES mail_accounts(id) ON DELETE CASCADE,
  cursor       text,
  last_sync_at timestamptz,
  last_error   text
);
CREATE TABLE IF NOT EXISTS mail_messages (
  id             text PRIMARY KEY,
  account_id     text NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  provider_id    text NOT NULL,
  rfc_message_id text,
  thread_id      text,
  folder         text NOT NULL DEFAULT 'INBOX',
  direction      text NOT NULL,
  internal_date  timestamptz,
  subject        text,
  from_addr      text,
  to_addr        text,
  UNIQUE (account_id, provider_id)
);
CREATE TABLE IF NOT EXISTS mail_events (
  id              text PRIMARY KEY,
  account_id      text,
  event           text NOT NULL,
  payload         jsonb NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_events_due_idx ON mail_events (delivered_at, next_attempt_at);
CREATE TABLE IF NOT EXISTS mail_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
`;

export async function migrate(): Promise<void> {
  await sql.unsafe(schema);
  // Added after the first release; `IF NOT EXISTS` keeps it idempotent.
  await sql`ALTER TABLE mail_oauth_states ADD COLUMN IF NOT EXISTS display_name text`;
}

export { sql };
export type Sql = typeof sql;
