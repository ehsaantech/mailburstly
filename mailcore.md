# Mailcore — replacing EmailEngine

**Status:** shipped (cut over) · **Date:** 2026-10-29 · **Deadline:** the
EmailEngine trial expires **2026-11-06**.

Companion to [architecture.md](./architecture.md). This document is the plan and
the record for `apps/mailcore`: the service that replaces the self-hosted
EmailEngine without changing the app's business logic.

---

## 0. TL;DR

- **`apps/mailcore`** is a TypeScript service (Bun + Hono) that speaks the
  **subset of EmailEngine's REST + webhook contract Mailrung actually uses**.
  The cutover is `EMAILENGINE_API_URL=http://mailcore:3004`; the api, worker and
  dispatcher keep their code.
- The mail protocol work is done by **the same MIT libraries EmailEngine is
  built on**: `imapflow` (IMAP), `nodemailer` (SMTP), `mailparser` (MIME).
  Gmail and Microsoft 365 are talked to over their REST APIs. Nothing here
  re-implements a mail protocol — see §3.
- The whole surface is **8 REST endpoints and 6 webhook events** (see §1). This
  is not "reimplement EmailEngine"; it is "own the 20% we call".
- Google OAuth: if the operators are on your Google Workspace domain, publish the
  app **Internal** — no verification, no CASA, no 100-user cap. If they are
  personal `@gmail.com` accounts, either publish **unverified** (works, but a
  warning screen and a 100-user cap) or go through verification + CASA. See §16.
- EmailEngine stays up as a **legacy fallback** for mailboxes connected before
  the cutover: a request for an account mailcore does not own is forwarded to
  it. Remove it once every mailbox has been re-consented.

---

## 1. What Mailrung actually uses today

Verified from the source, not the docs. EmailEngine is called from three places:

| Call site | File |
|---|---|
| api (connect, account lookup, delete, reconnect, verify, submit/manual reply) | `apps/api/src/lib/emailengine.ts` |
| worker (scheduled replies) | `apps/worker/src/lib/emailengine.ts` |
| dispatcher (campaign sends) | `apps/dispatcher/internal/sender/emailengine.go` |

### 1.1 REST endpoints

| Method + path | Who calls it | Why |
|---|---|---|
| `POST /v1/authentication/form` | api | Returns the hosted OAuth URL for "Connect mailbox" |
| `GET /v1/account/{id}` | api | Reads `email`, `name`, `type`, `state` after consent |
| `DELETE /v1/account/{id}` | api | Disconnect a mailbox |
| `PUT /v1/account/{id}/reconnect` | api | Re-run consent for a broken mailbox |
| `POST /v1/verifyaccount` | api | Validate a manual IMAP/SMTP pair (not used by OAuth mailboxes) |
| `POST /v1/account/{id}/submit` | api, worker, dispatcher | Send a message |
| `POST /v1/settings` | ops (curl) | Register the webhook URL + HMAC secret |
| `POST /v1/oauth2` | `scripts/setup-microsoft-oauth.ts` | Register the Outlook OAuth app with EmailEngine |

That is the entire integration. Everything else EmailEngine exposes (outbox,
templates, mail-merge, gateways, blocklists, admin UI, MCP, stats, license,
access tokens) is unused.

### 1.2 Webhook events

The worker verifies `X-EE-Wh-Signature` (HMAC-SHA256, base64url over the raw
body), dedupes on `X-EE-Wh-Event-Id`, and handles:

| Event | Fields the worker reads |
|---|---|
| `messageNew` | `account`, `data.{id,emailId,threadId,date,subject,from,to,messageId,inReplyTo,relatedMessageId,text.plain,text.html,isAutoReply,isBounce,isComplaint,headers}` |
| `messageBounce` | `account`, `data.{recipient,response.status,response.message,messageId}` |
| `messageComplaint` | `data.recipient` |
| `trackOpen`, `trackClick` | `data.{messageId,originalMessageId,url,userAgent}` |
| `listUnsubscribe` | `data.recipient` |

`messageSent` is acknowledged and ignored — the dispatcher already recorded the
send.

### 1.3 Semantics that are load-bearing

1. **`submit` returns an RFC Message-ID.** The dispatcher stores it in
   `sent_messages.message_id`, which is the join key for bounces, complaints and
   replies.
2. **`reference: {message, action: "reply", ignoreMissing: true}`** is how a
   reply is threaded. `message` is EmailEngine's own id (our
   `messages.provider_message_id`). An RFC Message-ID instead goes in
   `headers: {In-Reply-To, References}`. See `architecture.md` §Step 7.
3. **`data.id` is a stable per-message id** — the worker dedupes on it.
4. **`account` is EmailEngine's account id**, which is our
   `mailboxes.emailengine_id`. The api generates a UUID at connect time and
   reuses it, so mailcore can keep that contract exactly.
5. **Tracking is per-campaign** (`trackOpens`, `trackClicks`) and EmailEngine
   injects the pixel / rewrites links at submit time.

### 1.4 What we deliberately do not need

Multi-tenant EmailEngine apps, its admin UI, its message store and search API,
IMAP gateway, SMTP gateway, S/MIME, templates, mail-merge, outbox with retries,
VERP, delivery tests, logs/stats endpoints, MCP, license checks. If a feature is
not in §1.1–§1.3, it does not go in v1.

> **Note on generic IMAP.** `mailboxes.provider` has an `imap_smtp` value, but no
> live mailbox uses it. v1 is Gmail + Microsoft 365 only. A generic IMAP/SMTP
> adapter can be added behind the same `provider` interface later; it is not on
> the critical path.

---

## 2. Decision: EmailEngine's own wheels, API-compatible

| Choice | Options | Decision | Why |
|---|---|---|---|
| Mail protocol | Hand-rolled / the same MIT libraries EmailEngine uses | **`imapflow` + `nodemailer` + `mailparser`** | These *are* EmailEngine's IMAP/SMTP/MIME engines, MIT-licensed and battle-tested. The first attempt hand-rolled the protocol on `go-imap/v2` **beta.8** and cost three bugs in a day (a `defer c.Logout().Wait()` that logged out before `SELECT`, a pointer-vs-value type switch, a shadowed uid) |
| Runtime | Go / Bun+TS | **Bun + TypeScript** | One runtime with the api and the worker; the libraries are JS; the same code runs in the container and in `bun run dev` |
| Interface | New native API / EmailEngine-compatible | **EmailEngine-compatible** | Zero changes to business logic; A/B against the real EmailEngine; rollback is one env var |
| Deployment | New service / fold into the worker | **New `apps/mailcore`** | Token refresh and mail sync must not slow the send hot path |

**The one small change outside mailcore:** the api's `connect` must tell mailcore
which provider was chosen. Today it passes EmailEngine's opaque app id as
`type`. Add `provider: input.provider` to `AuthFormParams` (2 lines); mailcore
ignores `type`. Everything else stays.

---

## 3. Architecture

```
                        ┌────────────────────────────┐
  Browser ──connect────▶│  api (Bun)                 │
                        │  POST /v1/authentication/  │
                        │       form                 │
                        └─────────────┬──────────────┘
                                      │ { url }
                                      ▼
                        ┌────────────────────────────┐
   Browser ────────────▶│  mailcore (Go)             │
   provider consent     │  /oauth/start, /oauth/cb    │
   ────────────────────▶│  token vault + refresh     │
                        │                            │
                        │  /v1/*  (compat API)       │
                        │  /t/*   (pixel + clicks)   │
                        │  /u/*   (unsubscribe)      │
                        │                            │
                        │  sync loop  (30s)          │──▶ Gmail API
                        │  webhook outbox            │──▶ Graph API
                        └──────┬──────────────┬──────┘
                               │              │
                    Postgres   │              │  HMAC webhooks
                 (own tables)  ▼              ▼
                        ┌────────────┐  ┌──────────────┐
                        │ dispatcher │  │ worker       │
                        │  submit    │  │ messageNew…  │
                        └────────────┘  └──────────────┘
```

### 3.1 Package layout

```
apps/mailcore/
├── package.json
├── tsconfig.json
├── Dockerfile
└── src/
    ├── env.ts           zod-validated environment
    ├── db.ts            postgres-js pool + the mail_* tables
    ├── crypto.ts        AES-256-GCM token vault
    ├── store.ts         accounts, oauth state, cursors, messages, events
    ├── oauth.ts         google + microsoft authorize/exchange/refresh (PKCE)
    ├── providers.ts     imapflow (IMAP), nodemailer (SMTP), mailparser (MIME)
    ├── api-providers.ts Gmail API + Microsoft Graph over REST
    ├── webhook.ts       HMAC-SHA256 signing, envelope, backoff
    ├── legacy.ts        forward requests for accounts the old engine still holds
    └── index.ts         Hono routes, sync loop, delivery loop
```

### 3.2 Provider interface

```go
type Provider interface {
    // Send delivers a fully-built MIME message and returns the final
    // RFC Message-ID. It blocks until the provider accepted the message.
    Send(ctx context.Context, acct Account, msg []byte, threadHint string) (SendResult, error)

    // Sync returns messages changed since the cursor. A full sync is a nil cursor.
    Sync(ctx context.Context, acct Account, cursor Cursor) (Batch, error)
}
```

`SendResult{MessageID, ProviderID, ThreadID}`. `Batch{Messages []Inbound, Next Cursor}`.

---

## 4. OAuth

### 4.1 Flow

1. `POST /api/mailboxes/connect` → api generates `accountId` (UUID, reused as
   mailcore's account id) and calls mailcore `POST /v1/authentication/form`
   with `{account, provider, email, redirectUrl}`.
2. mailcore creates a one-time state row (signed random state, PKCE verifier,
   10-minute TTL) and returns
   `{url: "https://<mailcore>/oauth/start?state=…"}`.
3. `/oauth/start` redirects to the provider:
   - Google: `https://accounts.google.com/o/oauth2/v2/auth`
   - Microsoft: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
4. `/oauth/callback` exchanges the code, fetches the identity (id_token claims or
   `/me`), encrypts and stores the refresh token, then `302`s to
   `${PUBLIC_URL}/mailboxes/callback?account=<id>&state=new`.
   **The existing frontend route keeps working unchanged.**
5. A background refresher renews access tokens ~10 minutes before expiry, and
   marks the account `authentication_error` if the provider returns
   `invalid_grant`.

### 4.2 Scopes

| Provider | Scopes | Notes |
|---|---|---|
| Google | `openid email profile` + `https://www.googleapis.com/auth/gmail.modify` | One **restricted** scope. Covers read, send, labels/read-state. Do **not** use `https://mail.google.com/` (SMTP/IMAP path) — it is a much harder verification conversation and requires proving "full utilization" |
| Microsoft | `openid profile email offline_access User.Read` + `https://graph.microsoft.com/Mail.ReadWrite` + `Mail.Send` | Delegated. `Mail.ReadWrite` is what lets us mark read and (if needed) create a draft; `Mail.Send` sends. `offline_access` yields the refresh token |

Why Gmail API and not SMTP: `gmail.send` does **not** work over
`smtp.gmail.com` — SMTP XOAUTH2 requires `https://mail.google.com/`. The Gmail
API is the only way to send with the narrower scope. Reading mail already
requires a restricted scope, so `gmail.modify` is the minimum single scope that
covers the whole product.

### 4.3 Token vault

- AES-256-GCM, key from `MAILCORE_ENCRYPTION_KEY` (base64, 32 bytes). Store
  `key_version || nonce || ciphertext`.
- Refresh tokens never leave the vault; they are never logged and never returned
  by any endpoint.
- Rotate by adding a new key version and re-encrypting on read.
- Microsoft refresh tokens are long-lived but rotate; always persist the newest
  one returned by the token endpoint.

### 4.4 Account states returned to the api

`connected` (healthy), `syncing` (first sync in progress), `connecting`,
`authentication_error` (re-consent needed), `disconnected`. The api maps these
to health 95/80/50/0 exactly as it does now
(`healthFromState` in `apps/api/src/lib/emailengine.ts`).

---

## 5. Inbound sync

### 5.1 Initial sync

On the first successful consent, import the **last 14 days of INBOX** (configurable
`MAILCORE_INITIAL_SYNC_DAYS`). This is enough to attribute replies to recent
campaign sends and keeps the first sync fast. Store the cursor.

### 5.2 Incremental sync

| Provider | Mechanism | Cursor |
|---|---|---|
| Gmail | `users.history.list(startHistoryId)`; on `404` (history expired) fall back to `q=newer_than:2d` and reset | `historyId` |
| Graph | `GET /me/mailFolders/inbox/messages/delta` with `Prefer: odata.maxpagesize=50` | `@odata.deltaLink` |

Poll every **30 s** (`MAILCORE_SYNC_INTERVAL`). At this volume a full round is a
handful of requests, far below Gmail's per-user quota and Graph's 10,000
requests / 10 min / mailbox limit. A per-account semaphore of **1** is enough
and stays under Graph's 4-concurrent-request cap.

### 5.3 What to fetch per message

Fetch the **raw MIME** (`format=raw` on Gmail, `/$value` on Graph) and parse with
`mailparser`. Raw is the same shape from both providers and gives us every
header and both bodies without a second call:

- `From`, `To`, `Cc`, `Subject`, `Date`
- `Message-ID`, `In-Reply-To`, `References`
- `Auto-Submitted`, `X-Autoreply`, `Precedence` → `isAutoReply`
- `Content-Type: multipart/report` → bounce or complaint
- `List-Unsubscribe`, `List-Unsubscribe-Post`

Store a compact row in `mail_messages` (see §11) — **not** a full message store.
The worker keeps the body it needs; mailcore only needs the mapping from our id
to the provider id, RFC Message-ID, thread id and folder.

### 5.4 Emitting `messageNew`

For each new INBOX message, insert into the webhook outbox with:

```json
{
  "account": "<account id>",
  "event": "messageNew",
  "date": "2026-10-26T12:00:00.000Z",
  "path": "INBOX",
  "specialUse": "\\Inbox",
  "data": {
    "id": "<account-uuid>:<uid>",  // stable AND globally unique
    "emailId": "<provider id>",
    "threadId": "<provider thread>",
    "date": "…",
    "subject": "…",
    "from": {"name": "…", "address": "lead@example.com"},
    "to": [{"name": "…", "address": "sender@…"}],
    "messageId": "<rfc-message-id@…>",
    "inReplyTo": "<parent@…>",
    "relatedMessageId": "<parent@…>",
    "text": {"plain": "…", "html": "…"},
    "isAutoReply": false,
    "isBounce": false,
    "isComplaint": false,
    "headers": {"message-id": ["…"], "in-reply-to": ["…"]}
  }
}
```

**Deliberate difference:** do not emit `messageNew` for the Sent folder. The
dispatcher records campaign sends, the api records manual replies, and the
worker has no use for a third copy. This avoids duplicate inbox rows. Document
it in the cutover checklist and verify the Sent folder still fills at the
provider.

---

## 6. Sending

### 6.1 Request

The compat endpoint accepts exactly today's payload:

```json
{
  "to": [{"address": "lead@example.com"}],
  "subject": "…",
  "text": "…",
  "html": "…",
  "trackOpens": true,
  "trackClicks": true,
  "reference": {"message": "<our-message-id>", "action": "reply", "ignoreMissing": true},
  "headers": {"In-Reply-To": "<…>", "References": "<…>"}
}
```

### 6.2 Build the MIME

- `From`: account display name + address
- `To`, `Subject` (RFC 2047 encoded when non-ASCII)
- `Date`, `Message-ID` (generated: `<ULID@mailcore>`; see §6.4)
- `MIME-Version: 1.0`, `multipart/alternative` with `text/plain` + `text/html`
- Threading: resolve `reference.message` to the stored RFC Message-ID and
  thread id. Set `In-Reply-To` and `References` (append the parent's references
  when known). If `ignoreMissing`, send unthreaded instead of failing.
- `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  when the campaign flag is set (this is currently missing from the whole
  stack; mailcore can be the place it finally works).
- Tracking: rewrite links and append the pixel when the flags are set (§7).

### 6.3 Provider calls

| Provider | Call | Message-ID handling |
|---|---|---|
| Gmail | `POST /gmail/v1/users/me/messages/send` with `{raw: base64url(mime), threadId?}` | Gmail **overwrites** a custom `Message-ID`. After a successful send, `GET /users/me/messages/{id}?format=metadata` and read the real `Message-ID` header; return that |
| Graph | `POST /graph/v1.0/me/sendMail` with `Content-Type: text/plain` and base64 MIME | Set `Message-ID` in the MIME. Verify in the smoke test that it survives. If Exchange rewrites it, switch to `POST /me/messages` (MIME draft) → read `internetMessageId` → `POST /me/messages/{id}/send` |

Gmail's thread membership comes from the `threadId` field outside `raw`; pass it
when replying so the sent copy threads in the operator's mailbox too.

Graph's `sendMail` saves to Sent Items automatically. Gmail saves automatically.
**No IMAP APPEND is needed** — this is one of the reasons to use the APIs.

### 6.4 Message-ID and idempotency

- Generate `<{ulid}@{sending-domain}>` before the provider call. Persist it in
  `mail_messages` with `provider_id` once the provider confirms.
- The dispatcher has no idempotency key today. A duplicate `send_jobs` claim is
  prevented upstream by the state machine; mailcore does not retry a send after
  a provider `2xx`. On a network timeout, return `503` and let the dispatcher's
  retry/backoff decide — but add `X-Idempotency-Key` (the `send_jobs.id`) in a
  follow-up so a retry cannot double-send.
- `queueId` is optional; return the outbox row id for logging parity.

### 6.5 Error mapping

| Upstream | mailcore response | Effect |
|---|---|---|
| Gmail/Graph 401/403 `invalid_grant` | `401` + `fields[].message` | Account marked `authentication_error`; dispatcher fails the job |
| 429 / `Retry-After` | `503` + `Retry-After` | Dispatcher backs off; do **not** retry inline |
| 4xx validation | `400` with `message` + `fields[]` | The api surfaces the reason (it already formats `fields`) |
| 5xx / timeout | `503` | Dispatcher retries with backoff |

Mailcore waits for the provider's acceptance before returning `200`, so the
Message-ID the dispatcher stores is real. A typical send is ~300–800 ms, well
inside the dispatcher's 30 s timeout.

---

## 7. Tracking and unsubscribe

### 7.1 Open pixel

`<img src="https://<mailcore>/t/o/{token}.gif" width="1" height="1" alt="">` for
HTML bodies when `trackOpens`. `{token}` is an HMAC-signed `message_id`; the
handler records the event and returns a 1×1 GIF with `Cache-Control: no-store`.

### 7.2 Link rewriting

When `trackClicks`, every `http(s)` `<a href>` becomes
`https://<mailcore>/t/c/{linkId}`, with `linkId` stored in `mail_tracking_links`
(`id`, `message_id`, `target_url`). `GET /t/c/{id}` records the click and
`302`s to the target. Skip `mailto:`, the unsubscribe URL, and links already
pointing at mailcore.

### 7.3 Events

Emit `trackOpen` / `trackClick` with:
`data.{messageId: <RFC Message-ID>, originalMessageId: <RFC Message-ID>, url,
userAgent, ip, date}`. The worker's `sentMessageById` lookup is by RFC
Message-ID, so that is the value to send.

Dedupe opens per message per hour to keep the activity log readable (one row
per open is technically correct but noisy). Clicks are never deduped.

### 7.4 Unsubscribe

`GET /u/{token}` renders a one-line confirmation page;
`POST /u/{token}` (the `List-Unsubscribe-Post` target) records the request and
emits `listUnsubscribe` with `{recipient}`. The worker already unsubscribes the
lead and blocklists the address.

---

## 8. Bounces, complaints, auto-replies

These arrive as ordinary messages in INBOX; **do not rely on the provider's
bounce API**.

| Signal | Detection | Event |
|---|---|---|
| Hard bounce (DSN) | `Content-Type: multipart/report; report-type=delivery-status`; parse `message/delivery-status` for `Final-Recipient`, `Action: failed`, `Status: 5.x.x`, `Diagnostic-Code`, `Original-Message-ID` | `messageBounce` with `{recipient, action: "failed", response: {status, message}, messageId: <original>}` |
| Soft bounce / delay | Same part, `Status: 4.x.x` or `Action: delayed` | Log only; do **not** emit `messageBounce` (the worker treats every bounce as hard and would block a deliverable lead) |
| Complaint (ARF) | `report-type=feedback-report`; `Feedback-Type: abuse`; `Original-Rcpt-To` | `messageComplaint` with `{recipient}` |
| Auto-reply | `Auto-Submitted` ≠ `no`, `X-Autoreply`, `Precedence: auto_reply`, or the worker's own OOO rules | `isAutoReply: true` on `messageNew` |

The DSN's `Original-Message-ID` must match what we stored in `sent_messages`;
if it does not, fall back to `Final-Recipient` and let the worker blocklist the
address, which it already does.

---

## 9. Webhook contract

Match the existing worker exactly:

```
POST <worker webhook URL>
Content-Type: application/json
X-EE-Wh-Signature: base64url(HMAC-SHA256(secret, rawBody))
X-EE-Wh-Event-Id: <mail_events.id>      // stable across retries
```

- Verify with the same `EMAILENGINE_SERVICE_SECRET` today, or a new
  `MAILCORE_WEBHOOK_SECRET` with one line changed in the worker config.
- Retry `5 min → 30 min → 2 h → 6 h`, max 8 attempts; a `2xx` clears the row.
- Persist first, deliver second: the sync loop and the HTTP handlers must never
  wait on the worker.
- The worker acknowledges before doing the work and dedupes on the event id, so
  at-least-once delivery is safe.

---

## 10. Compatibility API

Keep the wire format; mailcore owns the semantics.

| Route | Behaviour |
|---|---|
| `POST /v1/authentication/form` | `{account, provider, email, redirectUrl}` → `{url}` pointing at `/oauth/start` |
| `GET /v1/account/{id}` | `{account, email, name, type: "gmail"\|"outlook", state, createdAt}` |
| `GET /v1/accounts` | Debug list |
| `DELETE /v1/account/{id}` | Revoke at the provider when possible, delete tokens + sync state; keep historical `mail_messages` |
| `PUT /v1/account/{id}/reconnect` | Re-run consent for the same account id |
| `POST /v1/verifyaccount` | Validate IMAP/SMTP pair (return `{imap:false, smtp:false}` until the IMAP adapter exists) |
| `POST /v1/account/{id}/submit` | §6 |
| `POST /v1/settings` | Persist `{webhooks, webhookEvents, serviceSecret, notifyText, notifyHeaders}`; ignore the rest. This keeps the README curl working |
| `POST /v1/oauth2` | Return a stored app id if configured; otherwise `400` with "configure GOOGLE_CLIENT_ID / MICROSOFT_CLIENT_ID in mailcore". The setup script is retired |
| `POST /v1/account/{id}/export` | Out of scope in v1 |
| `GET /health` | `{ok, accounts, queueDepth, lastSyncAt}` |

Auth: `Authorization: Bearer <MAILCORE_API_TOKEN>`, the same shared-secret model
as EmailEngine. The api's `EMAILENGINE_API_TOKEN` becomes `MAILCORE_API_TOKEN`
(or keep the variable name during cutover).

### 10.1 Accounts still held by the legacy engine

A mailbox connected **before** the cutover keeps the account id the legacy
engine gave it (usually the address itself, e.g. `aitchkhan@gmail.com`), and
its tokens live in the legacy engine's vault — not in mailcore's. mailcore
cannot send for such an account on its own.

So an account mailcore does not own is **forwarded to the legacy engine**:
`GET`/`DELETE /v1/account/{id}`, `PUT /v1/account/{id}/reconnect` and
`POST /v1/account/{id}/submit` are passed on verbatim (path, method, body,
bearer token) and the legacy engine's answer is returned untouched. A `404`
from the legacy engine means it does not own the account either, and mailcore
answers with its own `account not found`.

The forwarding is off until `MAILCORE_LEGACY_URL` is set:

| Variable | Meaning |
|---|---|
| `MAILCORE_LEGACY_URL` | Base URL of the legacy engine, e.g. `http://emailengine:3000`. Empty = off |
| `MAILCORE_LEGACY_TOKEN` | Bearer token for the legacy engine. Defaults to `MAILCORE_API_TOKEN` |

This is what keeps the cutover from breaking the send path: the api, the
worker and the dispatcher all point at mailcore and never learn that some
mailboxes are still served by the old engine. Once a mailbox is re-consented
through mailcore, mailcore owns it and the forwarding is no longer used for
it. When the last legacy mailbox is gone, unset the variable and remove the
`emailengine` service.

`GET /v1/accounts` lists both: mailcore-owned accounts are marked
`"source": "mailcore"`, the ones still held by the legacy engine
`"source": "legacy"`. It is the cutover checklist in one call.

---

## 11. Data model

All tables live in the existing `mailrung` database and are owned by mailcore.
No second database, no Redis for mailcore.

```sql
CREATE TABLE mail_accounts (
  id                text PRIMARY KEY,          -- = mailboxes.emailengine_id
  email             text NOT NULL,
  display_name      text,
  provider          text NOT NULL,             -- google | microsoft
  status            text NOT NULL,             -- connected | syncing | authentication_error
  scopes            text[] NOT NULL DEFAULT '{}',
  access_token_enc  bytea,
  refresh_token_enc bytea NOT NULL,
  key_version       int NOT NULL DEFAULT 1,
  access_expires_at timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_sync_state (
  account_id  text PRIMARY KEY REFERENCES mail_accounts(id) ON DELETE CASCADE,
  cursor      text,                            -- historyId | deltaLink
  last_sync_at timestamptz,
  last_error  text
);

CREATE TABLE mail_messages (
  id            text PRIMARY KEY,              -- ULID, the worker's data.id
  account_id    text NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  provider_id   text NOT NULL,                 -- Gmail id | Graph id
  rfc_message_id text,                         -- <…@…>  (the join key)
  thread_id     text,                          -- Gmail threadId | Graph conversationId
  folder        text NOT NULL DEFAULT 'INBOX',
  direction     text NOT NULL,                 -- inbound | outbound
  internal_date timestamptz,
  subject       text,
  from_addr     text,
  to_addr       text,
  UNIQUE (account_id, provider_id)
);
CREATE INDEX mail_messages_rfc_id_idx ON mail_messages (rfc_message_id);

CREATE TABLE mail_tracking_links (
  id         text PRIMARY KEY,
  message_id text NOT NULL,                    -- RFC Message-ID
  target_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_events (
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
CREATE INDEX mail_events_due_idx ON mail_events (delivered_at, next_attempt_at);

CREATE TABLE mail_oauth_states (
  state         text PRIMARY KEY,
  account_id    text NOT NULL,
  provider      text NOT NULL,
  code_verifier text NOT NULL,
  redirect_to   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz
);

CREATE TABLE mail_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
```

### 11.1 Narrow write to `mailboxes`

`mailboxes` is owned by the api. To avoid a stale "Connected" badge when a token
dies, mailcore is allowed exactly two writes, documented in `architecture.md`
§2:

```sql
UPDATE mailboxes SET status = $2, health_score = $3, last_checked_at = now()
WHERE emailengine_id = $1;
```

Nothing else. If that feels too loose, the alternative is a worker job that
polls `GET /v1/accounts` every minute — more moving parts for the same result.

---

## 12. Security

- **Secrets:** `MAILCORE_ENCRYPTION_KEY` (32 bytes, base64), `MAILCORE_API_TOKEN`,
  `MAILCORE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`.
  All from the environment; none in the repo.
- **OAuth state:** 32 random bytes, single-use, 10-minute TTL, PKCE S256.
  Reject unknown/used state with `400`.
- **Redirect allowlist:** the callback path is fixed
  (`/oauth/callback`); the post-consent redirect must start with `PUBLIC_URL`.
- **Token handling:** decrypt only in memory for the duration of a request; never
  log headers or token values; redact `Authorization` in access logs.
- **Webhook:** constant-time HMAC compare. If the secret is unset, refuse to
  start (do not silently accept unsigned events).
- **PII:** message bodies are not stored by mailcore; only headers/envelope.
  Add a `DELETE /v1/account/{id}/data` that purges `mail_messages`,
  `mail_tracking_links` and `mail_events` for an account, and document it in the
  privacy policy — CASA asks about deletion.
- **Least privilege:** `gmail.modify` only; Graph `Mail.ReadWrite` + `Mail.Send`
  only. No `Mail.Send.Shared`, no application permissions.
- **Rate limits:** per-account semaphore 1; global HTTP timeouts; `Retry-After`
  honoured.

---

## 13. Deployment

`docker-compose.yml` gains one service and loses one:

```yaml
mailcore:
  build:
    context: .
    dockerfile: apps/mailcore/Dockerfile
  restart: unless-stopped
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    DATABASE_URL: postgres://…/mailrung
    MAILCORE_PORT: 3004
    MAILCORE_PUBLIC_URL: ${MAILCORE_PUBLIC_URL:-http://localhost:3004}
    MAILCORE_API_TOKEN: ${MAILCORE_API_TOKEN}
    MAILCORE_WEBHOOK_URL: ${WORKER_WEBHOOK_URL:-http://worker:3002/webhooks/emailengine}
    MAILCORE_WEBHOOK_SECRET: ${MAILCORE_WEBHOOK_SECRET}
    MAILCORE_ENCRYPTION_KEY: ${MAILCORE_ENCRYPTION_KEY}
    MAILCORE_LEGACY_URL: ${MAILCORE_LEGACY_URL:-http://emailengine:3000}
    MAILCORE_LEGACY_TOKEN: ${MAILCORE_LEGACY_TOKEN:-${EMAILENGINE_API_TOKEN:-}}
    GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
    GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
    MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID}
    MICROSOFT_CLIENT_SECRET: ${MICROSOFT_CLIENT_SECRET}
    MICROSOFT_TENANT: ${MICROSOFT_TENANT:-common}
  ports:
    - "3004:3004"
```

- Remove the `emailengine` service and its volume; drop the `emailengine`
  database from `docker/postgres-init.sql` after the cutover.
- `docker/Caddyfile`: add `handle /t/ { reverse_proxy mailcore:3004 }`
  and `handle /u/`, `handle /oauth/`. The api keeps `/api/`.
- `PUBLIC_URL` stays the web app; `MAILCORE_PUBLIC_URL` is what goes into
  tracking pixels, links and the OAuth redirect. In dev they can be the same
  host with different ports; in prod both should be HTTPS on the same host.
- Health check: `GET /health`.

**Resource impact:** removes a ~250 MB Node container and its Postgres database;
mailcore is a ~25 MB Go binary. Net memory goes down.

---

## 14. Migration runbook

Run both engines side by side until every row below is green.

### Phase 0 — before touching code (day 0)

1. Ask Postal Systems for a trial extension (EULA §3.3) **and** a startup/monthly
   rate. A 30-day extension costs one email and de-risks the whole plan.
2. Create the Google OAuth app (§16.1) and the Entra app (§16.2) with mailcore's
   callback URL. This is the long-lead item.
3. Snapshot `pgdata` and the `emailengine` volume.

### Phase 1 — send path (days 1–3)

- OAuth connect for Gmail + M365, token vault, refresh loop.
- `submit` with MIME, threading, error mapping.
- `bun run verify:send` against mailcore; a real send to
  `haroon@yopmail.com`; check the Message-ID in the Sent folder matches what the
  dispatcher stored.

### Phase 2 — read path (days 4–7)

- Initial + incremental sync, `messageNew` emission.
- Reply to the test send from yopmail → it appears in the inbox, attributed to
  the lead and campaign.
- Bounce to a known-bad address → `bounces` row, blocklist row, lead invalid.
- ARF complaint (forward a real complaint or synthesize the MIME) →
  unsubscribed + blocklisted.

### Phase 3 — parity and hardening (days 8–10)

- Open pixel, click redirect, `List-Unsubscribe`, `/u/{token}` one-click.
- Restart mid-sync → no duplicates, no gaps.
- Token expired → refresh; token revoked → `authentication_error` and the
  mailbox badge turns red.
- Webhook receiver down → events retry and land once when it returns.
- Load: 50 sends/day/mailbox with pacing; verify Graph stays under 4 concurrent
  and Gmail under its per-user quota.
- `bun run typecheck`, `bun run test:ts`, `bun run test:go`; add
  `scripts/verify-mailcore.ts` and wire `bun run verify:mailcore`.

### Phase 4 — cutover (day 11)

1. Stop the dispatcher (or pause campaigns) so no sends are in flight.
2. Set `EMAILENGINE_API_URL=http://mailcore:3004` in the api, worker and
   dispatcher; keep the token the same. Set `MAILCORE_LEGACY_URL` on mailcore
   so the mailboxes that are still connected in the legacy engine keep
   sending (§10.1).
3. Reconnect each mailbox through the UI (re-consent; see risk R1).
4. Send one campaign email to `haroon@yopmail.com`, reply from yopmail, confirm
   both directions.
5. `GET /v1/accounts` on mailcore: every account must say
   `"source": "mailcore"`. While one still says `"source": "legacy"`, that
   mailbox is still served by the old engine.
6. Remove the `emailengine` service and volume, and unset
   `MAILCORE_LEGACY_URL`.

### Rollback

Point `EMAILENGINE_API_URL` back at `emailengine:3000`. EmailEngine's accounts
are still connected and its tokens are still valid until the trial ends, so
rollback is live for the length of the overlap window. After the trial expires
there is no rollback — which is why the extension email matters.

---

## 15. Build order and exit criteria

| Day | Deliverable | Exit criterion |
|---|---|---|
| 1 | Skeleton, config, pgx store, `/health`, Dockerfile | `docker compose up mailcore` is healthy |
| 2 | Google OAuth, token vault, refresh | `GET /v1/account/{id}` returns `type: gmail`, `state: connected` |
| 3 | Microsoft OAuth + MIME send (both providers) | Test send to `haroon@yopmail.com` from each provider; Message-ID matches |
| 4 | Compat `submit`, threading, error mapping | `verify:send` passes; reply threads onto the parent |
| 5 | Initial sync + `messageNew` | A reply sent from yopmail lands in the Unibox, attributed |
| 6 | Incremental sync (history/delta) + dedupe + restart safety | 24 h soak, no duplicates, cursor advances |
| 7 | DSN + ARF → bounce/complaint | Hard bounce blocks the lead; soft bounce does not |
| 8 | Tracking pixel + link rewrite + events | Open and click appear in analytics |
| 9 | `List-Unsubscribe` + `/u/{token}` | One-click POST unsubscribes and blocklists |
| 10 | Retry, backoff, auth-error surfacing, load test | Worker down/up delivers exactly once; revoked token turns the badge red |
| 11 | Cutover + remove EmailEngine | Campaign → send → reply → analytics, end to end |

**Total: ~10 working days for one engineer who knows the repo.** The send path is
2–3 days; the read path and deliverability are the rest. If the trial is extended,
use the extra time to add the IMAP/SMTP adapter and a second provider pass.

---

## 16. OAuth in production

### 16.1 Google — pick the audience first

The right answer depends on **whose mailboxes** these are.

| Situation | User type | Verification | CASA | Refresh token life | Users |
|---|---|---|---|---|---|
| Operators are on your Google Workspace domain | **Internal** | Not required | Not required | Long-lived | Anyone in the org |
| Personal `@gmail.com` accounts, ≤100 people, internal tool | External, **published unverified** | Not required to publish | Not required | Long-lived | 100 cap, warning screen |
| External customers / >100 users | External, **verified** | Required | Required (annual) | Long-lived | Unlimited |
| Development only | External, **Testing** | n/a | n/a | **7 days** | 100 test users |

**The trap:** an External app left in **Testing** issues refresh tokens that
expire after **7 days** (Google's OAuth docs). Every mailbox dies weekly. Never
ship that. Either publish (unverified is enough for an internal tool) or go
Internal.

#### Path A — Internal (easiest, no review)

1. Move the Cloud project into your Google Cloud **Organization** (IAM & Admin →
   Settings shows the org; if it is blank, migrate the project).
2. Google Auth platform → **Audience → User type: Internal**.
3. Create an OAuth client (Web application) with redirect URI
   `https://<host>/oauth/callback` (and `http://localhost:3004/oauth/callback`
   for dev).
4. In the Workspace Admin console, allow the app to use restricted Gmail scopes:
   Security → Access and data control → API controls → App access control →
   **Trust internal apps** (or configure the app as trusted).
5. Consent as any user in the org. No verification, no CASA, no 100-user cap.

#### Path B — External, published unverified (personal Gmail, small team)

1. Google Auth platform → Branding: app name, support email, logo, **privacy
   policy URL**, terms of service, authorized domain (verify the domain in
   Search Console).
2. Data Access: add `.../auth/gmail.modify` + `openid`, `email`, `profile`.
3. Audience: External; add the operators as test users while developing.
4. **Publish app.** The status goes to "In production" and refresh tokens stop
   expiring weekly.
5. Users see "Google hasn't verified this app" → Advanced → continue. The app is
   capped at **100 users**; scopes are not shown on the consent screen until
   verified.
6. This is legitimate for an internal tool. It is not a path to selling the
   product to strangers.

#### Path C — Full verification (only when selling to external users)

Do this in parallel with the build; it is the long pole.

1. **Brand:** public homepage, privacy policy and terms on the verified domain;
   app name matches the domain; support email monitored.
2. **Scopes:** declare `gmail.modify` and nothing broader. Justification text:
   "Read inbox replies, send from the user's address, and mark threads
   read/apply labels." Explain why `gmail.send` alone is insufficient (no read)
   and why `https://mail.google.com/` is not needed (we use the REST API, not
   IMAP/SMTP).
3. **Demo video:** unlisted YouTube, English UI, shows the full OAuth grant with
   the exact scopes on the consent screen, then connect → send → receive →
   disconnect/delete data.
4. **Submit for verification** in the Cloud Console; answer Trust & Safety's
   questions (expect 1–3 rounds).
5. **CASA Tier 2:** Google notifies you to start; choose an authorized assessor.
   Cost is **$500–$4,500**, takes **2–3 weeks** (Tier 3 is 4–6). HITRUST/SOC 2/ISO
   27001 can shorten it via the CASA Accelerator. Upload the Letter of
   Validation (LOA).
6. **Publish.** Re-assess every **12 months**.

**Make it easy on yourself:**

- One restricted scope, not three. Every extra scope is another justification.
- A real domain and a privacy policy that names Gmail data, retention and
  deletion. This is what CASA checks first.
- Record the demo video once, after the UI is final; re-recording is the most
  common delay.
- Do **not** request `https://mail.google.com/`. Google requires proof of "full
  utilization" (including permanent delete) and it is the slowest approval.
- Keep a test Google account with a real inbox for the reviewer; they do sign in.

### 16.2 Microsoft

Much cheaper than Google.

1. **Entra app registration** ([entra.microsoft.com](https://entra.microsoft.com)):
   - Supported account types: **single tenant** for an internal tool; "any
     organizational directory + personal" only when customers connect their own
     mailboxes.
   - Redirect URI (Web): `https://<host>/oauth/callback` and
     `http://localhost:3004/oauth/callback`.
   - Certificates & secrets: a client secret (prefer a certificate in prod).
2. **API permissions (delegated):** `Microsoft Graph → Mail.ReadWrite`,
   `Mail.Send`, `User.Read`, `offline_access` (the last is requested at runtime,
   not in the portal). Click **Grant admin consent** — by Microsoft's default
   consent policy, `Mail.ReadWrite` is not user-consentable, so an admin must
   approve it once per tenant.
3. **No verification is required for your own tenant.** For multi-tenant apps,
   **publisher verification** is free but needs a Microsoft AI Cloud Partner
   Program (Partner One) account and a DNS-verified publisher domain. Without it,
   admins see an "unverified publisher" warning and risk-based step-up consent
   can block users.
4. Microsoft refresh tokens are long-lived and rotate on use; persist the newest
   one. `invalid_grant` means re-consent.

### 16.3 Choosing today

If the two mailboxes in the stack (`@ehsaanlabs.com` and `@gmail.com`) are the
real audience: keep the Google app **External, published unverified** until there
is a customer, and keep the Microsoft app **single-tenant**. That is zero review
work and covers the internal tool. Start the Google verification clock only when
an external user is on the roadmap — the CASA fee and the 2–3 week wait are the
gate, not the code.

---

## 17. Risks and open decisions

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Re-consent is likely.** EmailEngine's refresh tokens may not be exportable; the trial expiring forces re-auth anyway | Plan the cutover as "reconnect every mailbox"; tell operators it is a 30-second consent each. EmailEngine's `export` may carry tokens — test it before the trial ends. Until a mailbox is re-consented, mailcore forwards its sends to the legacy engine (§10.1), so nothing breaks in between |
| R2 | **Gmail API rewrites Message-ID** | Read the sent message's metadata after send and return the real one (§6.3). Verify in the smoke test |
| R3 | **Graph drops custom headers when sending MIME** | The `Message-ID` is generally preserved; if not, use the draft → read `internetMessageId` → send path. Both are specced |
| R4 | **Google verification blocks external launch** | Internal/publish-unverified now; start verification only when a customer requires it |
| R5 | **Soft bounces block good leads** | Emit `messageBounce` only for `5.x.x`; log `4.x.x` (fixes an existing worker bug) |
| R6 | **Tracking hurts deliverability** | Per-campaign toggle already exists; default off for cold outreach, on for warm follow-ups |
| R7 | **No idempotency key on submit** | Add `X-Idempotency-Key` = `send_jobs.id` in the dispatcher follow-up; mailcore dedupes in `mail_events`/`mail_messages` |
| R8 | **Two send paths** (worker `scheduled-replies` calls submit directly) | Both go through mailcore, so the transport is unified; the architecture cleanup is separate |
| R9 | **Mailcore becomes a single point of failure** | It is stateless except Postgres; restart is safe. Dispatcher backs off when it is down; campaigns surface `all_accounts_unhealthy` |
| R10 | **Provider policy changes** | Keep the provider interface; an IMAP/SMTP adapter is the escape hatch, not the default |

**Open decisions for the operator:**

1. Internal vs External Google app — depends on whether the sending domains are
   on a Workspace you control (§16.1).
2. Single-tenant vs multi-tenant Entra app — single now unless customers connect
   their own M365.
3. Is a ~10-day build acceptable, or should we buy an extension and take 3 weeks?
4. Does the product ever need generic IMAP (non-Gmail, non-M365)? If yes, add
   the adapter in v2; do not block v1 on it.

---

## 18. References

- Gmail API scopes and restricted-scope rules:
  <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Gmail XOAUTH2 (IMAP/SMTP needs `https://mail.google.com/`):
  <https://developers.google.com/workspace/gmail/imap/xoauth2-protocol>
- OAuth refresh-token expiry in Testing (7 days):
  <https://developers.google.com/identity/protocols/oauth2>
- OAuth app state matrix (Internal vs Testing vs Published):
  <https://developers.google.com/identity/protocols/oauth2/production-readiness/overview>
- Restricted scope verification and CASA:
  <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
- CASA cost and duration:
  <https://support.google.com/cloud/answer/13464321>
- Microsoft Graph `sendMail` with MIME:
  <https://learn.microsoft.com/en-us/graph/api/user-sendmail>
- Microsoft Graph Outlook throttling:
  <https://learn.microsoft.com/en-us/graph/throttling-limits>
- Microsoft publisher verification:
  <https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview>
- EmailEngine API surface (for parity checks):
  <https://learn.emailengine.app/docs/api/emailengine-api>


---

## 19. What shipped (2026-10-29)

The plan above is live. What changed from the plan, and why:

| Plan | Shipped | Reason |
|---|---|---|
| A Go service | **TypeScript on Bun** | The mail protocol is done by `imapflow` / `nodemailer` / `mailparser` — the same MIT libraries EmailEngine uses. Hand-rolling IMAP on `go-imap/v2` beta.8 cost three bugs in a day. One runtime with the api and the worker is simpler to run |
| Gmail API + Graph only | **+ IMAP/SMTP** | Spaceship (and most bought mailboxes) are plain IMAP/SMTP. `imapflow` + `nodemailer` cover them, and `verifyaccount` now dials SMTP for real |
| Provider-native message ids | **`<account-uuid>:<uid>`** | IMAP UIDs and Graph ids are unique only *within* one mailbox, and the worker dedupes `provider_message_id` globally. Unprefixed, only the first mailbox's mail was stored |
| `enmime` for MIME | **`mailparser`** | Same reason: it is the parser EmailEngine uses |
| Open tracking pixel | **implemented** | `GET /t/o/{id}.gif`, `GET /t/c/{id}`, `GET|POST /u/{token}` |

### Live state

- 5 mailboxes connected: 4 Spaceship IMAP/SMTP (`haroon@`, `haroonkhan@`,
  `haroon.khan@`, `hkhan@theehsaantech.com`) + `tayyab@ehsaanlabs.com`
  (Microsoft Graph).
- Both send paths verified against `haroon@yopmail.com`: Spaceship SMTP and
  Microsoft Graph.
- Inbound sync parses real mail and delivers `messageNew` to the worker.
- The api gained `POST /api/mailboxes/:id/test-send` and a "Test send" modal
  per mailbox card; the Connect modal now takes IMAP/SMTP credentials and the
  api verifies both before registering the account.
- EmailEngine is still running as the legacy fallback (`MAILCORE_LEGACY_URL`).
  Remove it, its volume and the `emailengine` database once every mailbox has
  been re-consented through mailcore.

### Third-party dependencies

| Package | License | Used for |
|---|---|---|
| `imapflow` | MIT | IMAP — the engine behind EmailEngine |
| `nodemailer` | MIT | SMTP, and MIME composition |
| `mailparser` | MIT | Parsing inbound MIME |
| `hono` | MIT | The HTTP surface (already in the api) |
| `postgres` | MIT | The database (already in the api) |
| `zod` | MIT | Env validation (already in the api) |

No runtime beyond Bun and Postgres. No Redis, no Node service, no EmailEngine.
