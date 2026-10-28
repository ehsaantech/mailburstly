# Mailrung — Architecture

Companion to [PRD.md](./PRD.md). This document covers **how the system is built and how the pieces connect**. The PRD covers *what* the product does; this covers *how the machine works*.

|                     |                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **Status**          | Draft v1                                                                                         |
| **Date**            | 2026-10-22                                                                                       |
| **Stack**           | Bun + Hono (api) · Bun (worker) · React (web) · Go (dispatcher) · Postgres · Redis · EmailEngine |
| **Deployment**      | Single VPS, Docker Compose                                                                       |
| **Package manager** | Bun workspaces (`bun install`, `bun run`)                                                        |

---

## 1. Topology

Five processes, two datastores, one VPS.

```
                          ┌──────────────────────┐
   Browser ──────────────▶│  caddy (edge)        │
                          │  React SPA + proxy   │
                          └──────────┬───────────┘
                                     │ REST + WS
                          ┌──────────▼───────────┐
                          │  api (Bun)           │──── reads/writes ────┐
                          │  Hono + Drizzle      │                     │
                          └──────────┬───────────┘                     │
                                     │ enqueue                       │
                          ┌──────────▼───────────┐                     │
                          │  worker (Bun)         │                     │
                          │  BullMQ v6            │                     │
                          │  • scheduler          │                     │
                          │  • reply intake       │                     │
                          │  • AI classify        │                     │
                          │  • webhooks           │                     │
                          └───┬──────────────┬────┘                     │
                              │              │ enqueue                 │
                ┌─────────────▼───┐   ┌──────▼─────────┐               │
                │ dispatcher (Go) │   │  Postgres      │◀──────────────┘
                │ batch + pace    │──▶│  source of     │
                └─────┬───────────┘   │  truth         │
                      │               └──────▲─────────┘
                ┌─────▼───────────┐          │
                │  EmailEngine    │──────────┘
                │  OAuth/IMAP/SMTP│  webhooks
                └─────────────────┘
```

`Redis` sits behind `worker` (BullMQ queues) and `api` (realtime pub/sub). `Postgres` is the only durable source of truth — Redis may be lost and rebuilt.

### Service responsibilities

| Service | Runtime | Owns | Never does |
|---|---|---|---|
| `web` | React + Vite + TS | UI: dashboard, campaigns, mailboxes, leads, Unibox, analytics, settings | Talk to Postgres directly |
| `api` | Bun + Hono + Drizzle | Auth, CRUD, campaign config, lead management, analytics queries, **manual replies**, macros, auto-pause rules, the CSV export, public REST API, WebSocket fan-out | Schedule sends, run long jobs inline |
| `worker` | Bun + BullMQ | Scheduling, reply intake, attribution, AI classification, **auto-pause**, **scheduled replies**, subsequences, webhook delivery, stats aggregation | Submit SMTP |
| `dispatcher` | Go | Batching, pacing, rotation, quota — the send hot path | Business logic, AI, Postgres writes outside `send_jobs` |
| `emailengine` | EmailEngine (self-hosted) | OAuth2 flows, token refresh, IMAP, SMTP transport, its own outbox | Any business decision |

---

## 2. Write ownership

Contention is what breaks these systems. Every table has exactly one writer, with one deliberate exception.

| Table | Written by | Read by |
|---|---|---|
| `campaigns`, `campaign_steps`, `step_variants` | api | worker, dispatcher |
| `campaign_subsequences`, `campaign_subsequence_steps` | api | worker |
| `leads`, `lead_lists`, `lead_labels`, `lead_list_members` | api | worker |
| `mailboxes`, `domains` | api | worker, dispatcher |
| `webhooks`, `api_keys`, `import_jobs` (create) | api | worker |
| **`send_jobs`** | **worker creates → dispatcher claims → dispatcher advances the lead** | all |
| **`campaign_leads`** (advance to next step) | dispatcher | api, worker |
| **`sent_messages`** | **dispatcher** (at send time) | worker |
| **`activities`** (append-only) | worker, dispatcher | api |
| `messages`, `conversations` | worker, api (a manual reply) | api |
| `macros` | api | api, web |
| `lead_status_events`, `opportunities` | worker | api |
| `auto_pause_rules` | api | worker, api |
| `auto_pause_events` | worker | api |
| `mailbox_daily_stats` | dispatcher | api, worker |
| `bounces`, `blocklist` | worker | api |
| `campaign_daily_stats` | worker (rollup) | api |
| `lead_lists`, `lead_list_members` | api | worker |
| `campaign_lists` | api | worker |
| `auto_pause_rules` | api | worker, api |
| `auto_pause_events` | worker | api |
| `webhook_deliveries` | worker | api |
| `subsequence_enrollments` | worker | api |
| `processed_webhook_events` | worker | — |
| `verifications` | worker | api |

`send_jobs` is the transactional seam between the scheduler's intent and the dispatcher's execution. Its state machine is strictly ordered — worker creates → dispatcher claims → worker confirms:

```
pending ──claim──▶ claimed ──confirm──▶ sent
   │                   │
   │                   ├──▶ hard_bounced ──▶ lead invalid + blocklisted
   │                   ├──▶ soft_bounced ──▶ retry (5min / 30min / 2h) → risky
   │                   └──▶ failed        ──▶ retry with backoff, count to mailbox error rate
   └──skipped (blocklisted, unsubscribed, campaign no longer active)
```

---

## 3. The outbound loop — how an email goes out

### Step 1 — Scheduler decides (worker, every 30s)

For each active campaign, find `campaign_leads` where `state = 'active'` and `next_step_at <= now()`. Apply, in order:

1. Schedule window match (per rule, in that rule's own timezone)
2. Daily campaign limit not exceeded
3. Max-new-leads-per-day not exceeded
4. Stop conditions — lead replied / bounced / unsubscribed / company-stopped
5. Blocklist check (email + domain, suffix-aware on label boundaries)
6. Mailbox availability — at least one healthy mailbox below its cap

Survivors get a `send_jobs` row. The scheduler decides **which lead gets which step**. It does *not* decide which mailbox or where in the gap — that is the dispatcher's job.

### Step 2 — Dispatcher claims (Go, every 2s)

```sql
SELECT * FROM send_jobs
WHERE state = 'pending' AND scheduled_at <= now()
ORDER BY scheduled_at
FOR UPDATE SKIP LOCKED
LIMIT 500
```

`SKIP LOCKED` lets a second dispatcher replica claim a disjoint set of rows with zero coordination. We run one today; horizontal scale is a compose-file change, not a code change.

### Step 3 — Dispatcher paces (the deliverability-critical step)

Group by mailbox. For each mailbox:

```
sent_today + in_flight_today + 1 <= daily_cap      (hard ceiling 50)
now - last_send_from_this_mailbox >= gap             (campaign's email_gap_minutes)
```

then add random jitter (0–`random_wait_max` minutes). `in_flight_today` = count
of `send_jobs` in state `claimed` for that mailbox today.

The campaign owns its pacing: `campaigns.email_gap_minutes` and
`campaigns.random_wait_max` decide the gap and the jitter. The dispatcher's
`DEFAULT_MIN_GAP_SECONDS` and `DEFAULT_RANDOM_JITTER_SECONDS` are **floors** —
they can make sending stricter, never looser — so the operator can impose a
global minimum without editing every campaign.

The gap is measured against the **mailbox's** last send, not the lead's. It
models how often this inbox has talked to the outside world, and a per-lead
measurement would let two campaigns to different leads send at the same
instant from the same mailbox.

If the computed slot is in the future, the dispatcher **rewrites `scheduled_at` to that slot and skips it this tick**. It deliberately does *not* submit a whole batch to EmailEngine and let it burst out — that would defeat the entire pacing design, which is the thing protecting sender reputation. The job goes back to `pending` so the next cycle picks it up.

### Step 3b — The preview goes through the dispatcher

The sequence editor shows a preview of a step with real values in it, and
sends a test to a chosen address. Both render through the dispatcher's
`POST /render` endpoint, because the dispatcher is what sends the real
message.

A preview rendered anywhere else could disagree with what actually goes
out, and a preview that shows a `{{token}}` the real email would not is
worse than no preview at all. The api asks; the dispatcher answers.

### Step 4 — Dispatcher renders and submits

The body is rendered **at send time**, because merge variables, Spintax and
Liquid are per-lead transforms that must be resolved exactly once, on the
message that actually goes out.

The dispatcher then submits to EmailEngine:

```
POST /v1/account/{emailengine_id}/submit
{ "to": [{ "address": … }], "subject": …, "text": …, "html": …,
  "trackOpens": <campaign flag>, "trackClicks": <campaign flag> }
```

The account id in the URL path is EmailEngine's account id, not our mailbox
id — the two differ, and sending to the wrong one fails. `to` is an array of
address objects, not a string.

EmailEngine inserts the tracking pixel and rewrites the links itself when
`trackOpens` / `trackClicks` are on, so the dispatcher does not touch the
HTML. The resulting `trackOpen` / `trackClick` webhooks become activities.

### Step 5 — EmailEngine sends

It owns OAuth2, token refresh, IMAP, and SMTP. Its own short outbox handles SMTP-level retries. This is the reason we self-host it: we never write a line of mail-protocol code.

### Step 6 — Confirmation (dispatcher, synchronously)

The submit call returns a Message-ID. The dispatcher, in the same tick:

1. Marks the `send_jobs` row `sent`
2. Writes `sent_messages` — the Message-ID joined to the lead, campaign, step and variant
3. Records an `activities` row of type `email_sent`
4. Advances `campaign_leads.current_step_id` → next step, sets `next_step_at = now + step.delay`
5. Increments `mailbox_daily_stats.sent`
6. On hard bounce (a later webhook): marks the lead `invalid`, adds to the global blocklist, writes a `bounces` row, stops the lead in every campaign
7. On soft bounce: schedules a retry at 5 min / 30 min / 2h; after three failures, marks the lead `risky` (not blocked)

**Quota safety.** `sent_today` only increments on *confirmed* send, and the dispatcher's quota check counts `claimed` jobs as in-flight. So the daily cap is never overshot, even if EmailEngine is slow to confirm.

---

## 4. The inbound loop — how a reply comes back

### Step 0 — The join key

EmailEngine does not use VERP, so the only reliable link between a message we
sent and a message that comes back is the **Message-ID**. The dispatcher writes
`sent_messages` at send time, keyed on that id, carrying the lead, campaign,
step and variant. Every inbound event is correlated through it.

Without that table a bounce cannot be attributed to a lead, and a reply cannot
be attributed to the campaign that caused it.

### Step 1 — Delivery

EmailEngine watches every connected mailbox and posts to
`worker:/webhooks/emailengine`. The events we consume are `messageNew`,
`messageBounce`, `messageComplaint`, `trackOpen`, `trackClick` and
`listUnsubscribe`.

Two headers make the endpoint safe:

- `X-EE-Wh-Signature` — HMAC-SHA256 over the raw body, base64url, keyed on
  EmailEngine's `serviceSecret`. Verified in constant time. A request without a
  valid signature is a 401.
- `X-EE-Wh-Event-Id` — the idempotency key. EmailEngine retries a failed
  delivery up to ten times, so the same event really does arrive more than
  once; the id is recorded in `processed_webhook_events` and a repeat is a
  no-op.

The handler acknowledges **before** it does the work. A slow handler turns one
event into ten deliveries.

### Step 2 — Attribution

Which lead and which campaign replied? Matching order:

1. `inReplyTo` matching a `sent_messages` row → exact lead, campaign and step
2. `from` address matching `lead.email` → lead, then the most recently
   contacted campaign
3. Neither → the thread is stored with no lead, and the operator sees it in
   the inbox as an unmatched reply

### Step 3 — Store

`conversations` + `messages`. One thread per (mailbox, contact, campaign).

### Step 4 — Classify

A rule-based classifier runs first — OOO patterns, unsubscribe phrases,
interest. These short-circuit with **no model call**.

The rules live in a pure module (`components/events/classify.ts`) so each one
is unit-tested. When a model is configured, everything the rules do not
short-circuit goes to it, through `components/classification/`:

```
reply ──▶ rules: OOO? unsubscribe?  ──yes──▶ decided, no model call
             │
             no
             ▼
          model (Ollama)
             │
             ├─ failed / unparseable ──▶ the rules answer
             │
             └─ answered
                  │
                  confidence ≥ 0.7 ──▶ the label is applied
                  │
                  confidence < 0.7 ──▶ a confident rule result still stands;
                                       otherwise no label is applied and the
                                       reply is left in the inbox for a human
```

**The rules are the floor, the model is the improvement.** With no API key
the rules answer every reply and nothing downstream changes. A model failure
is never fatal.

Two Ollama surfaces are used, chosen by the model name:

| Model | Endpoint | Why |
|---|---|---|
| `clef:27b` (a decision model) | `/v1/systemone` | Built for exactly this: returns a probability per label plus a real concentration score. $0.24 per million input tokens, no output cost. No prompt engineering. |
| any chat model | `/v1/chat/completions` | OpenAI-compatible. The model is asked for one JSON object. |

The distinction matters: a decision model returns a **real** confidence score,
which is what `LLM_CLASSIFY_MIN_CONFIDENCE` is compared against. A chat
model asked to rate its own confidence returns a number that is not
calibrated, so the service treats a chat-path answer as a weaker signal and
lets a confident rule result override it.

**The LLM pass was a later refinement that sits behind the same interface**
as the rules. The PRD's original design had the rules short-circuit only OOO
and unsubscribe — which is what is implemented.

### Step 5 — Apply

Update `leads.status_id`, write `lead_status_events`, record `activities`. If
the resulting status has interest `Positive` and the message carries a buying
signal, create an `opportunity`.

**Priority rule:** an unsubscribe signal always wins over an interest
classification, and a hard bounce wins over everything.

An out-of-office is a **pause, not a stop**: the lead's `ooo_until` is set and
the scheduler skips the lead until that date passes.

### Step 7 — What the operator does next

Four things can happen to a conversation, and each one is a different path
through the api:

| Action | Endpoint | What it does |
|---|---|---|
| Reply now | `POST /inbox/conversations/:id/reply` | Sends through EmailEngine, records an outbound message and an `email_sent` activity, and — when the campaign says `stop_on_reply` — stops the lead's sequence |
| Reply later | `POST /inbox/conversations/:id/schedule` | Stores the draft on the conversation; the worker sends it when the time comes |
| Remind me | `POST /inbox/conversations/:id/remind` | Sets `remind_at`; the conversation shows up in Reminders |
| Attach a lead | `POST /inbox/conversations/:id/attach-lead` | Links a reply that arrived from an unknown address to a lead, and moves it into Primary |

**A manual reply stops the sequence.** A human deciding to answer is a
stronger signal than any rule, and continuing to email someone who just
wrote back is how a sending domain gets blocked.

**A reply is threaded, not a new thread.** The submit names the message it
answers in `reference`, and EmailEngine fills in the `In-Reply-To` and
`References` headers from it, and flags that message as answered. The
submit payload has no `inReplyTo` field — one in the body fails the whole
request with 400 "Invalid input".

The folders are queries over the same rows — `primary`, `unread`,
`reminders`, `scheduled`, `sent`, `others`, `archived` — so no conversation
is ever in two places.

### Step 8 — What the operator sees

The analytics surface is built on one source of truth, `activities`, and it
distinguishes the things that are easy to conflate:

| Number | What it counts |
|---|---|
| sent | emails, not contacts — a lead emailed twice counts twice |
| contacted | distinct leads we sent something to |
| replied | distinct leads who wrote back, ignoring auto-replies |
| unique replies | distinct leads who wrote back at all, auto-replies included |
| auto replies | distinct leads who only sent an autoresponder |
| positive replies | distinct leads whose current status is a positive one |

The reply rate is `replied ÷ sent` by default. The dashboard has a toggle
for the other reading, because an out-of-office is not a conversation and
counting it inflates the number.

**Diagnose** answers "why is this campaign not sending?" with one reason and
one remedy. The reasons are checked from the most fundamental down — a draft
campaign is not "out of schedule", and a paused one is not "waiting for
leads" — so the answer always names the thing the operator has to change
first:

`campaign_draft` · `paused` · `paused_by_rule` · `out_of_schedule` ·
`daily_limit_met` · `waiting_for_leads` · `no_accounts_assigned` ·
`all_accounts_unhealthy` · `sending`

**Lists** are a view over the workspace's leads, never a copy. The
`campaign_lists` attachment is what makes them useful: attaching a list
enrolls everyone in it, and — while the campaign is running and set to
enroll on add — a lead added to the list afterwards is enrolled too.
Deleting a list never deletes a lead.

**Per-mailbox metrics** answer "which inbox is degrading". The score blends
the mailbox's health with the engagement it actually produced, so a mailbox
that only opens and never replies does not score well.

### Step 9 — Housekeeping

The scheduler's tick also runs two things that are not about sending:

- **Auto-pause.** Every enabled rule is evaluated against every running
  campaign. A campaign whose bounce rate crosses the threshold is paused with
  a reason, and the pause is written to `auto_pause_events` so the operator
  can see *why* it stopped. A campaign with nothing sent yet has no rate to
  judge, so it is never paused.
- **Scheduled replies.** A conversation with a `scheduled_reply_at` in the
  past is sent and the schedule is cleared. A failed send is logged and the
  draft is dropped rather than retried forever: a reply stuck in the queue is
  worse than a reply that did not go out, because the operator can see the
  conversation is still open and write it again.

### Step 6 — Fan out

1. Evaluate subsequences (reply / keyword triggers) → enroll matching leads
2. Fire outbound webhooks
3. Push a realtime update over Redis → api → browser

---

## 5. Realtime and webhooks

Two distinct outbound paths, deliberately separated.

**Realtime** — for the web UI only:

```
worker → Redis pub/sub → api WebSocket handler → browser
```

Channels: `activities`, `inbox`, `campaign`, `mailbox`. This is why `api` holds a Redis subscriber.

**Webhooks** — for external systems:

```
worker → webhook_deliveries → HTTP POST → visible delivery log
```

Signed with `X-Mailrung-Signature: sha256=<hex>` — HMAC-SHA256 over the body
— plus an `X-Mailrung-Event` header naming the activity type. Every payload
carries a stable `id` so consumers can dedupe. Delivery is at-least-once: a
receiver that answers 5xx gets the event again, so receivers are expected to
be idempotent.

Webhooks run out of band. A dead endpoint must never block a campaign, so a
delivery failure is recorded and swallowed.

---

## 6. Design rationale

### Why Go is a separate service from Bun

The worker is bursty and I/O-bound — AI calls, email parsing, webhook delivery. Bun is excellent at that, and its native fetch and fast startup make it a good fit.

The dispatcher is a tight rate-limiting loop where a GC pause means a missed min-gap window or a quota overshoot. Both directly damage sender reputation, which is the product.

Splitting them means a slow classification call can never delay a send, and the send path stays predictable under load. They share only Postgres and Redis. The Go service's advantage is concrete: cheap concurrent I/O, predictable latency, and a small resident set — the batching and rate-limit math runs in a tight native binary with no GC pauses.

### Why Bun + Hono (not Node + Fastify)

- **Hono is web-standard.** Handlers take a `Request` and return a `Response`. That means the same route code can run on Bun today and on Cloudflare Workers or Deno later, and the test story is trivial — no server harness, just call the handler.
- **Native WebSockets.** `hono/bun`'s `upgradeWebSocket` gives us the realtime fan-out without `ws` or `socket.io`. The api subscribes to Redis and forwards over the same Bun server.
- **One toolchain.** Bun is the runtime, the test runner, the package manager, and the bundler. Fewer moving parts than Node + tsx + vitest + pnpm.

### Postgres driver: `postgres-js`, not `bun-sql`

Drizzle ORM stays. The **native Bun driver does not**, because it has open correctness bugs:

| Issue | Status | Impact |
|---|---|---|
| [#30494](https://github.com/oven-sh/bun/issues/30494) — prepared-statement cache returns the wrong statement when two cached queries share a parameter count but differ in type | Closed as *not planned*; still live in 1.3.14 | **Silent wrong-row results** |
| [#30010](https://github.com/oven-sh/bun/issues/30010) — `Bun.SQL` connection wrapper leak, ~9k objects/hour | Open | RSS +340MB/h → OOM in a long-running worker |
| [#32004](https://github.com/oven-sh/bun/issues/32004) — pool stalls when concurrent `begin()` mixes with pooled queries | Fixed | Was a hard hang |

We therefore use **`drizzle-orm/postgres-js` + `postgres`**:

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const sql = postgres(process.env.DATABASE_URL!, {
  max: 20,
  idle_timeout: 30,
  max_lifetime: 60 * 30,
  prepare: true,
});
export const db = drizzle({ client: sql });
```

This is the exact substitution the #30494 reporter validated under a real workload — same Bun runtime, same load, only the driver changed:

| Metric | `bun-sql` | `postgres-js` |
|---|---|---|
| RSS at 8h | ~2,700 MB, climbing linearly | 255 MB, oscillating |
| Leak | 63,901 wrappers in heap | gone |
| Wrong-row bug | present | unaffected |

**Rule: `drizzle-kit` runs under Node, never Bun.** [Issue #8545](https://github.com/oven-sh/bun/issues/8545): `bun --bun drizzle-kit push` read `Object.values()` on the schema module as empty and **dropped the entire database**. The migration script is invoked with `npx drizzle-kit`, not `bun x`.

We accept one slower query path in exchange for not risking silent data corruption. Revisit only if Bun ships a fix that closes #30494 *and* #30010, and only after a soak test reproduces stable memory under our own load.

### Why BullMQ v6 on Bun

BullMQ v6 is the first version with a **pluggable backend and a Bun adapter**:

- `createBunRedisClient` wraps Bun's built-in `RedisClient` — no `ioredis`, no Node `net` shim.
- Bun-specific reconnect and `duplicate()` bugs were fixed in 6.3.3 / 6.3.6.
- v6 also ships a **PostgreSQL backend**. We use Redis today for the queue, but this leaves the door open to collapsing to a single datastore if Redis ever becomes a burden.

We use BullMQ rather than a hand-rolled queue because the worker genuinely needs delayed jobs (webhook retry at 5min/30min/2h), exponential backoff, concurrency limits per queue, and a job dashboard. Those are not worth reimplementing.

### Why EmailEngine

OAuth2 consent flows, token refresh, IMAP threading, and provider-specific SMTP quirks are weeks of work and a permanent maintenance burden. Self-hosting takes the whole problem off the table.

### Why `send_jobs` is an outbox

It is the transactional seam. If the worker dies between "decide to send" and "record it", the job is either already in Postgres (dispatcher picks it up) or never created. No lost sends, no duplicate sends. The `send_jobs.id` is the idempotency key.

### Why activity log is append-only

`activities` is the only table that grows without bound. It is written once, never updated, and drives every analytics view. Partition it monthly once it passes ~5M rows. Aggregate tables (`*_daily_stats`) are derived and rebuildable.

---

## 7. Data contracts between services

`api` and `worker` share TypeScript packages; `dispatcher` is Go and talks to Postgres directly.

### Repo layout

```
mailrung/
├── apps/
│   ├── web/          React + Vite + TS (SPA)
│   ├── api/          Bun + Hono + Drizzle
│   ├── worker/       Bun + BullMQ
│   └── dispatcher/   Go
├── packages/
│   ├── shared/       enums, types, webhook event names
│   └── db/           Drizzle schema + client + migrations + seed
├── docker-compose.yml
└── architecture.md
```

Workspaces are managed by Bun (`bun install` at the root). `packages/shared` and `packages/db` are imported by `apps/api` and `apps/worker` via the `workspace:*` protocol. `apps/web` may import `@mailrung/shared` for enums and display types, but never `@mailrung/db` — the browser must not bundle a Postgres client.

```
packages/shared   — enums, types, webhook event names  (TS only)
packages/db       — Drizzle schema + client + migrations (TS only)
```

The Go service cannot import TypeScript, so it carries its own minimal structs and explicit SQL. **The columns it depends on are the contract** and are listed here so a schema change that breaks it is caught deliberately, not at 3am:

| Table | Columns the dispatcher reads |
|---|---|
| `send_jobs` | `id`, `state`, `scheduled_at`, `campaign_lead_id`, `step_id`, `subsequence_step_id`, `mailbox_id`, `variant_id`, `attempts`, `last_error` |
| `campaign_subsequence_steps` | `id`, `position`, `subject`, `body_html`, `delay_minutes` |
| `campaign_leads` | `id`, `lead_id`, `campaign_id`, `state`, `current_step_id`, `last_sent_at` |
| `campaign_steps` | `id`, `position`, `subject`, `body_html`, `body_text`, `delay_minutes`, `thread_mode` |
| `campaign_subsequence_steps` | `id`, `position`, `subject`, `body_html`, `delay_minutes` |
| `step_variants` | `id`, `step_id`, `subject`, `body_html`, `weight` |
| `campaigns` | `id`, `workspace_id`, `name`, `email_gap_minutes`, `random_wait_max`, `open_tracking`, `link_tracking`, `text_only`, `insert_unsubscribe_header` |
| `leads` | `id`, `email`, `first_name`, `last_name`, `company`, `title`, `custom_variables` |
| `mailboxes` | `id`, `email`, `emailengine_id`, `status`, `daily_cap`, `health_score` |
| `mailbox_daily_stats` | `mailbox_id`, `date`, `sent`, `bounced`, `errors` |

The dispatcher writes to `send_jobs` (`state`, `scheduled_at`, `attempts`,
`last_error`), `sent_messages`, `activities`, `campaign_leads` (the step
advance) and `mailbox_daily_stats`. Those five are its entire write surface.

It also exposes one read-only endpoint, `POST /render`, which renders a
template against merge variables. The api uses it for the sequence editor's
preview and test send, so a preview can never disagree with the real
message.

### Variable rendering

The dispatcher renders the final message body before sending, because merge variables, Spintax, and Liquid are all per-lead transforms that must be resolved exactly once, at send time.

Rules:

- `{{variable}}` → lead value, else the declared fallback, else empty string. **A raw `{{token}}` must never reach a recipient.**
- Fallback triggers on `NULL` *and* on empty string when `useFallbackOnEmpty` is set.
- Spintax `{a|b|c}` → one option chosen per send, recorded in `campaign_leads.variant_assignments` so analytics can attribute per-variant performance. Nested spintax supported.
- Liquid `{% if %} / {% unless %} / {% case %} / {{ x | default: "y" }}` → parsed per lead. On a parse error, fall back to the plain-text body and flag the step in the UI rather than failing the send.
- HTML body values are escaped; plain-text body values are not.

Implementation notes:

- The render pass is a pure function in `internal/render`, so every rule is
  unit-tested without a database or a network.
- Spintax and merge tags share one pass, and **merge tags are copied through
  untouched**: a `|` inside `{{ x | default: "y" }}` is a filter, not a
  choice separator. A group with no pipe (`{50}`) is literal text.
- A condition (`{% if company %}`) evaluates against the **raw** value, with
  no readable fallback — otherwise "if company" would be true for every lead
  who has no company.
- Negative wins over positive in the interest classifier, and a pricing
  question counts as a buying signal rather than a bare question.

---

## 8. Build order

| Milestone | Builds | Connects to | State |
|---|---|---|---|
| **M1** Foundation | Postgres schema, compose stack, api skeleton, web shell, auth, mailboxes CRUD + EmailEngine OAuth connect | EmailEngine live; a real mailbox connected | done |
| **M2** Leads | CSV/Sheets import, column mapping, dedupe, variables, lists, lead table, verification | DB only | done |
| **M3** Engine | Campaign/step/variant model, sequence builder, **Go dispatcher**, send_jobs, bounces, blocklist | M1 + M2 → **first real email sent** | done |
| **M4** Inbox | Webhook intake, attribution, Unibox, inline reply, statuses, OOO auto-resume, opportunities | M3 → **first reply lands** | done |
| **M5** Analytics | Campaign/step/variant/mailbox metrics, activity log, auto-pause rules, subsequences, webhooks + public API | M3 + M4 | done |
| **M6** AI + polish | Reply classification, reply suggestions, DNS/blacklist checks, text-only mode, `List-Unsubscribe`, templates | M4 | not started |

**M3 is the inflection point** — the first email out the door. **M4 is the second**, because reply handling cannot be built without a reply to handle.

M6's classifier hook is already in place: `classify.ts` is a pure module, so
adding an LLM pass behind it does not change any call site.

---

## 8b. Testing

The suite is split by what it can prove.

| Suite | Command | Proves |
|---|---|---|
| Go unit tests | `bun run test:go` | The renderer, the pacer, the render-data merge, the claim query |
| Bun unit tests | `bun run test:ts` | The send-window rules, the stop conditions, the reply classifier, the auto-pause rules, the CSV builder |
| Webhook pipeline | `bun run verify:events` | A signed webhook produces the right rows: a reply becomes a conversation, a status and an opportunity; an OOO parks the lead; an unsubscribe blocks the address; a hard bounce invalidates the lead; an open is attributed |
| Api surface | `bun run verify:api` | Every route the new features added, including the auth failures |
| Inbox & analytics | `bun run verify:inbox` | The folder filter, reminders, macros, attach-lead, inline reply, scheduled replies, auto-pause rules, the CSV export |
| Worker behaviour | `bun run verify:worker` | A scheduled reply goes out when it is due, and a campaign is auto-paused when its metric crosses |
| Send path | `bun run verify:send` | A real email leaves with its variables rendered, its Message-ID recorded, and the scheduler honouring a closed send window |
| Model classifier | `bun run verify:llm` | The model classifies real replies the way it should, and how much it costs |
| Web render | `bun run smoke` | Every route renders in both themes with no console errors |

The Go store test needs a database, and skips itself when there is none — it
is an integration test, not a unit test, and it must not fail the build on a
machine without Postgres.

---

## 9. Local development

```bash
# infra only
docker compose up -d postgres redis emailengine

# install
bun install

# schema
bun run db:migrate
bun run db:seed                          # creates the admin user

# services, with hot reload
bun run dev                              # api + worker + web
cd apps/dispatcher && go run ./cmd/dispatcher
```

Or the full stack, which is what the VPS runs:

```bash
docker compose up -d --build
```

---

## 10. Failure and recovery

| Failure | Behavior |
|---|---|
| Worker dies mid-schedule | `send_jobs` rows already committed are picked up by the dispatcher. No sends lost. |
| Dispatcher dies mid-submit | Jobs stuck in `claimed` are reclaimed by a lease timeout (default 10 min) and re-submitted. The `send_jobs.id` idempotency key prevents double-send. |
| EmailEngine down | Dispatcher submission fails, jobs stay `claimed`, retry with backoff. Campaign surfaces `all_accounts_unhealthy`. |
| Postgres down | Workers back off and retry. Redis is disposable. |
| Redis down | Scheduler and dispatcher degrade to degraded mode; Postgres remains authoritative. |
| A webhook endpoint is down | Delivery retries 3× with backoff, logged and visible in the UI. Campaign unaffected. |
| Reply webhook missed | Worker reconciles by polling EmailEngine every 5 minutes as a backstop. |

---

## 10b. Postmortem: 10 duplicate sends (2026-10-23)

Ten identical emails were delivered to one lead. Root cause, and the two
defences now in place.

### What happened

The scheduler treated a lead with `current_step_id IS NULL` as *newly
enrolled*:

```ts
if (!cl.currentStepId) {
  await repo.updateCampaignLead(cl.id, {
    currentStepId: firstStep.id,
    nextStepAt: new Date(),      // due immediately
  });
}
```

That assumption is wrong. `current_step_id` is also NULL when a sequence
**finishes** — the dispatcher's `AdvanceLead` had no next step to move to, so
it set the column to NULL but left `state = 'active'`.

So the loop was:

1. Dispatcher sends the only step, sets `current_step_id = NULL` and
   `next_step_at = now() + 0 minutes` (a 1-step campaign has no follow-up).
2. Next scheduler tick (30s later) sees `current_step_id IS NULL` → concludes
   the lead is brand new → resets `next_step_at = now()` → re-queues it.
3. Repeat, forever, one email per tick.

A second, independent path made the lead due again: the old `AdvanceLead` also
wrote `next_step_at = now() + delay`, and with a one-step campaign the delay
is zero, so the lead was due the instant it was sent.

### Fixes

| Fix | Where | Why |
|---|---|---|
| `AdvanceLead` sets `state = 'completed'` when there is no next step, and nulls `current_step_at`/`next_step_at` | `apps/dispatcher/internal/store/store.go` | Removes the lead from the scheduler's `state = 'active'` set entirely. This is the real fix. |
| `hasPendingJob(campaignLeadId)` guard before queueing | `apps/worker/src/components/scheduler/repository.ts` | Second line of defence. Even if a lead is somehow due twice, it is not queued twice while a job is outstanding. |
| The scheduler no longer advances `next_step_at` at all | `apps/worker/src/components/scheduler/service.ts` | `next_step_at` is owned solely by the dispatcher. Advancing it in the scheduler would silently skip a lead whose send never happened. |

### Verification

A lead enrolled in a fresh campaign produced **1 job across 4+ scheduler
ticks** (previously 10 across 5 minutes).

### Lesson

`current_step_id IS NULL` is ambiguous — it means both "never started" and
"finished". A nullable column that means two different things is a bug
waiting to happen. The state column (`active` / `completed` / `stopped`)
already disambiguates it; the null check was redundant and harmful.

---

## 11. Open decisions

1. **EmailEngine's send API vs. direct SMTP from Go.**
   Specced: EmailEngine owns transport *and* its outbox. Alternative: Go speaks SMTP directly and EmailEngine only hands over OAuth tokens — faster per send, but couples us to EmailEngine's token storage. Revisit only if submission latency becomes a problem.

2. **Webhook event id.**
   Postgres sequence, not UUID, so the value is monotonic and consumers can detect gaps.

3. **Multi-workspace.**
   v1 is single-tenant, but every table carries `workspace_id`, so multi-tenant is a data-layer change rather than a migration.

4. **Reuse of sibling projects.**
   `gtm-engineer/check-if-email-exists` and `gtm-engineer/openehsaan-emchecker` may already implement verification. Worth reviewing before building §3.19 of the PRD.
