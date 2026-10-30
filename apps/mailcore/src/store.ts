/**
 * The account store: mailboxes, their tokens, their sync cursor, and the
 * events waiting to be delivered to the worker.
 */
import { randomUUID } from "node:crypto";

import { sql } from "./db";
import { open, seal } from "./crypto";
import type { Account, Provider } from "./providers";

interface AccountRow {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  settings: unknown;
  status: string;
  scopes: string[];
  access_token_enc: string | null;
  refresh_token_enc: string;
  access_expires_at: Date | null;
  last_error: string | null;
}

function normalizeSettings(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    provider: row.provider as Provider,
    status: row.status,
    scopes: row.scopes ?? [],
    accessToken: row.access_token_enc ? open(row.access_token_enc) : "",
    refreshToken: row.refresh_token_enc ? open(row.refresh_token_enc) : "",
    accessExpiresAt: row.access_expires_at
      ? row.access_expires_at.getTime()
      : 0,
    settings: normalizeSettings(row.settings),
  };
}

export async function listAccounts(): Promise<Account[]> {
  const rows = await sql<
    AccountRow[]
  >`SELECT id, email, display_name, provider, settings, status, scopes,
              access_token_enc, refresh_token_enc, access_expires_at, last_error
       FROM mail_accounts ORDER BY created_at`;
  return rows.map(toAccount);
}

export async function getAccount(id: string): Promise<Account | null> {
  const rows = await sql<
    AccountRow[]
  >`SELECT id, email, display_name, provider, settings, status, scopes,
              access_token_enc, refresh_token_enc, access_expires_at, last_error
       FROM mail_accounts WHERE id = ${id}`;
  const row = rows[0];
  return row ? toAccount(row) : null;
}

export async function upsertAccount(input: {
  id: string;
  email: string;
  displayName: string | null;
  provider: Provider;
  status: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  settings?: Record<string, unknown>;
}): Promise<void> {
  const settings = (input.settings ?? {}) as any;
  await sql`
    INSERT INTO mail_accounts
      (id, email, display_name, provider, settings, status, scopes,
       access_token_enc, refresh_token_enc, access_expires_at, updated_at)
    VALUES (
      ${input.id}, ${input.email}, ${input.displayName}, ${input.provider},
      ${sql.json(settings)}, ${input.status}, ${input.scopes},
      ${input.accessToken ? seal(input.accessToken) : null},
      ${seal(input.refreshToken)},
      ${new Date(input.expiresAt)},
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      email = ${input.email},
      display_name = ${input.displayName},
      provider = ${input.provider},
      settings = ${sql.json(settings)},
      status = ${input.status},
      scopes = ${input.scopes},
      access_token_enc = ${input.accessToken ? seal(input.accessToken) : null},
      refresh_token_enc = ${seal(input.refreshToken)},
      access_expires_at = ${new Date(input.expiresAt)},
      updated_at = now()
  `;
}

export async function updateTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): Promise<void> {
  await sql`
    UPDATE mail_accounts
       SET access_token_enc = ${seal(accessToken)},
           refresh_token_enc = ${seal(refreshToken)},
           access_expires_at = ${new Date(expiresAt)},
           updated_at = now()
     WHERE id = ${id}
  `;
}

export async function setAccountStatus(
  id: string,
  status: string,
  lastError: string | null = null,
): Promise<void> {
  await sql`
    UPDATE mail_accounts
       SET status = ${status}, last_error = ${lastError}, updated_at = now()
     WHERE id = ${id}
  `;
}

export async function deleteAccount(id: string): Promise<void> {
  await sql`DELETE FROM mail_accounts WHERE id = ${id}`;
}

/* -------------------------------------------------------------------------- */
/* OAuth state                                                                 */
/* -------------------------------------------------------------------------- */

export interface OAuthStateRow {
  state: string;
  accountId: string;
  provider: string;
  codeVerifier: string;
  redirectTo: string;
  displayName: string | null;
}

export async function saveOAuthState(row: OAuthStateRow): Promise<void> {
  await sql`
    INSERT INTO mail_oauth_states
      (state, account_id, provider, code_verifier, redirect_to, display_name)
    VALUES (
      ${row.state}, ${row.accountId}, ${row.provider},
      ${row.codeVerifier}, ${row.redirectTo}, ${row.displayName}
    )
  `;
}

/** Reads the state and marks it used, so a code cannot be replayed. */
export async function takeOAuthState(
  state: string,
): Promise<OAuthStateRow | null> {
  const rows = await sql<
    {
      state: string;
      account_id: string;
      provider: string;
      code_verifier: string;
      redirect_to: string;
      display_name: string | null;
      used_at: Date | null;
    }[]
  >`SELECT state, account_id, provider, code_verifier, redirect_to, display_name, used_at
       FROM mail_oauth_states WHERE state = ${state}`;
  const row = rows[0];
  if (!row || row.used_at) return null;
  await sql`UPDATE mail_oauth_states SET used_at = now() WHERE state = ${state}`;
  return {
    state: row.state,
    accountId: row.account_id,
    provider: row.provider,
    codeVerifier: row.code_verifier,
    redirectTo: row.redirect_to,
    displayName: row.display_name,
  };
}

/* -------------------------------------------------------------------------- */
/* Sync cursor                                                                 */
/* -------------------------------------------------------------------------- */

export async function getCursor(accountId: string): Promise<string> {
  const rows = await sql<{ cursor: string | null }[]>`
    SELECT cursor FROM mail_sync_state WHERE account_id = ${accountId}
  `;
  return rows[0]?.cursor ?? "";
}

export async function setCursor(
  accountId: string,
  cursor: string,
): Promise<void> {
  await sql`
    INSERT INTO mail_sync_state (account_id, cursor, last_sync_at)
    VALUES (${accountId}, ${cursor}, now())
    ON CONFLICT (account_id) DO UPDATE
      SET cursor = ${cursor}, last_sync_at = now()
  `;
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

/** Inserts the message, and reports whether it was new. */
export async function recordMessage(
  id: string,
  accountId: string,
  providerId: string,
  rfcMessageId: string | null,
  threadId: string | null,
  folder: string,
  direction: "inbound" | "outbound",
  internalDate: number,
  subject: string | null,
  from: string | null,
  to: string | null,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO mail_messages
      (id, account_id, provider_id, rfc_message_id, thread_id, folder,
       direction, internal_date, subject, from_addr, to_addr)
    VALUES (
      ${id}, ${accountId}, ${providerId}, ${rfcMessageId}, ${threadId},
      ${folder}, ${direction}, to_timestamp(${internalDate} / 1000.0),
      ${subject}, ${from}, ${to}
    )
    ON CONFLICT (account_id, provider_id) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export interface EventRow {
  id: string;
  accountId: string | null;
  event: string;
  payload: string;
  attempts: number;
}

export async function enqueueEvent(
  accountId: string | null,
  event: string,
  payload: unknown,
): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO mail_events (id, account_id, event, payload)
    VALUES (${id}, ${accountId}, ${event}, ${JSON.stringify(payload)}::jsonb)
  `;
  return id;
}

export async function dueEvents(limit = 50): Promise<EventRow[]> {
  const rows = await sql<
    {
      id: string;
      account_id: string | null;
      event: string;
      payload: unknown;
      attempts: number;
    }[]
  >`SELECT id, account_id, event, payload, attempts
       FROM mail_events
      WHERE delivered_at IS NULL AND next_attempt_at <= now()
      ORDER BY created_at
      LIMIT ${limit}`;
  // postgres-js returns a jsonb column as its JSON *text*, not as a parsed
  // object. Stringifying it again would double-encode it, and the worker
  // would receive `data` as a string — where `data.from` is undefined and the
  // message is dropped without a word.
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    event: r.event,
    payload: typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload),
    attempts: r.attempts,
  }));
}

export async function markDelivered(id: string): Promise<void> {
  await sql`UPDATE mail_events SET delivered_at = now() WHERE id = ${id}`;
}

export async function markFailed(
  id: string,
  error: string,
  nextAttemptAt: Date,
): Promise<void> {
  await sql`
    UPDATE mail_events
       SET attempts = attempts + 1, last_error = ${error},
           next_attempt_at = ${nextAttemptAt}
     WHERE id = ${id}
  `;
}
