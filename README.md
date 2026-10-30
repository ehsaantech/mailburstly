# Mailrung

Internal cold-email campaign runner. Instantly-shaped, scoped for 2–3 internal
operators, warmup deliberately deferred.

- **[PRD.md](./PRD.md)** — what the product does
- **[architecture.md](./architecture.md)** — how the system is built and wired
- **[mailcore.md](./mailcore.md)** — how `apps/mailcore` took over the mail protocol work,
  and how to run OAuth in production

## Status

**M1–M5 complete.** The full stack runs on one VPS via Docker Compose. A cold
email goes out with its variables rendered, the reply comes back, gets
classified, and lands in the inbox and the analytics.

| Layer | Runtime | State |
|---|---|---|
| `apps/web` | React 19 + Vite + Tailwind v4 | Dashboard, Campaigns, Campaign detail, Leads, Mailboxes, **Inbox** and **Analytics** wired to the real API. Lists and Settings still on mock data. |
| `apps/api` | Bun + Hono + Drizzle | Auth, mailboxes, campaigns, leads, inbox, analytics, webhooks, api keys, subsequences, public API. |
| `apps/worker` | Bun + BullMQ | Scheduler tick (send windows, stop conditions, blocklist), mail event intake (replies, bounces, opens, clicks, unsubscribes), daily aggregation, outbound webhook delivery, subsequence runner. |
| `apps/dispatcher` | Go | Claims `send_jobs` with `FOR UPDATE SKIP LOCKED`, renders the template, applies pacing/quota/jitter, submits to mailcore, records the Message-ID. |
| `apps/mailcore` | Bun + Hono | The mail gateway: OAuth2, IMAP/SMTP, Gmail API, Microsoft Graph, tracking, and the mail events the worker consumes. |
| `packages/db` | Drizzle + postgres-js | Schema, migrations, seed. 27 tables. |
| `packages/shared` | — | Enums, types, webhook event names. |

### What works, end to end

- **Personalisation** — `{{variables}}`, `{{ x | default: "y" }}`, `{% if %}`,
  and `{spintax}`, rendered at send time in the Go dispatcher. A raw token can
  never reach a recipient.
- **Sequence editor** — build a campaign's steps in the browser: add, edit,
  reorder and delete them, set the delay in days, add A/Z variants, preview
  the message with real values, and send a test to a real address. The
  preview goes through the dispatcher, so it is exactly what a lead gets.
- **Send windows** — a campaign's `schedule` (mode `always` / `office_hours` /
  `custom`, with per-rule timezone) gates the scheduler. Overnight windows
  (22:00–06:00) are handled.
- **Stop conditions** — `stop_on_reply`, `stop_on_auto_reply`,
  `stop_for_company`, `daily_max_leads`, and the out-of-office pause.
- **Bounce → blocklist** — a hard bounce invalidates the lead, writes a
  `bounces` row, adds the address to the blocklist and stops the lead in
  every campaign.
- **Inbox** — replies are attributed to a lead and campaign through the
  Message-ID, classified (positive / negative / question / out-of-office /
  unsubscribe), and turned into status changes and opportunities. Folders
  (primary, unread, reminders, scheduled, sent, others, archived), inline
  reply, scheduled replies, reminders, macros and attach-lead.
- **Analytics** — `activities` is the source of truth; a rollup produces daily
  per-campaign, per-step and per-variant numbers. The funnel distinguishes
  sent emails from contacted leads, human replies from auto-replies, and
  unique replies from raw ones. Per-mailbox metrics show which inbox is
  degrading. The activity log is filterable by every dimension and exports to
  CSV. Outbound webhooks and a key-authenticated public API expose it all.
- **Auto-pause** — a rule pauses a campaign whose bounce rate, reply rate,
  open rate, unsubscribe rate or mailbox health crosses a threshold, and
  records why.
- **Diagnose** — every campaign says why it is not sending: out of schedule,
  daily limit met, waiting for leads, no accounts assigned, all accounts
  unhealthy, paused by rule.
- **Subsequences** — a lead who replies can be moved into a follow-up
  sequence; the main sequence pauses until it finishes.
- **Lead lists** — named, reusable collections. Create, rename, duplicate and
  delete them; add and remove members; attach one to a campaign and
  everyone in it is enrolled. A lead added to an attached list afterwards is
  enrolled too, unless the campaign turned that off. Deleting a list never
  deletes a lead.
- **Reply suggestions** — the inbox composer can draft a reply from the
  thread, with the campaign and the lead as context.
- **Dashboard** — live numbers, not a mock: today's sends and replies, the
  30-day trend, what needs attention, the campaigns that are running, the
  activity feed and open opportunities.

### Reply classification

Replies are classified by rules, with an optional model behind them.

```bash
# .env
LLM_PROVIDER=ollama
LLM_API_KEY=...          # https://ollama.com/settings/keys
LLM_BASE_URL=https://ollama.com
LLM_MODEL=clef:27b
LLM_CLASSIFY_MIN_CONFIDENCE=0.7
```

| Model | Endpoint | Input | Output | Notes |
|---|---|---|---|---|
| `clef:27b` | `/v1/systemone` | $0.24/M | — | A decision model: returns a probability per label and a real confidence score. Needs a paid plan or usage credits. |
| `gpt-oss:20b` | `/v1/chat/completions` | $0.07/M | $0.30/M | Works on the free plan. |
| `nemotron-3-super` | `/v1/chat/completions` | $0.015/M | $0.60/M | The cheapest input. |

At 2,000 tokens per reply, `clef` costs about **$0.0005 a reply** — roughly
$4.80 for ten thousand replies in a month.

**With no key the rules answer every reply** and nothing else changes. An
out-of-office or an unsubscribe is always decided by the rules, with no model
call: a legal obligation should not depend on a confidence score. A model
failure falls back to the rules. An answer below the confidence threshold
applies no label, so a lead is never silently mislabeled.

```bash
bun run verify:llm      # sends a handful of replies to the live model
```

### Test suite

```bash
bun run test              # Go unit tests + Bun unit tests
bun run verify:events     # the mail event pipeline, against a live stack
bun run verify:api        # every api route the new features added
bun run verify:inbox      # folders, reminders, macros, inline reply, auto-pause, CSV export
bun run verify:m5         # the funnel, activity log, mailbox metrics, diagnosis
bun run verify:editor     # the sequence editor, the preview, the test send, the suggestions
bun run verify:lists      # list creation, membership, duplication, campaign attachment
bun run verify:worker     # scheduled replies send, and a bad campaign is auto-paused
bun run verify:send       # a real send, with rendering, pacing and windows
bun run verify:llm        # the model-backed classifier (needs LLM_API_KEY)
bun run smoke             # every web route rendered in both themes
```


## Stack

| Layer | Choice |
|---|---|
| Web | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS v4 (CSS-first, semantic tokens) |
| Routing | React Router 7 |
| Server state | TanStack Query |
| Charts | Hand-rolled SVG (no chart dependency) |
| Package manager | Bun workspaces |

Backend: Bun + Hono api, Bun + BullMQ worker, Go dispatcher, Postgres, Redis,
`apps/mailcore`, our own mail gateway. See `architecture.md`.

## Quick start

```bash
bun install
bun run dev            # http://localhost:5173
```

Or the whole stack, which is what the VPS runs:

```bash
cp .env.example .env   # then fill in MAILCORE_API_TOKEN
docker compose up -d --build
open http://localhost:8080
```

Login: `admin@example.com` / `change-me-admin-password` (seeded).

To point the web app at the real API instead of the mock dataset, build it with
`VITE_USE_MOCKS=false` (the compose default) or run Vite with that env var.

### The edge (Caddy)

Caddy is the only proxy in the stack, in local and in production alike. It
serves the built React SPA and routes everything that belongs to a backend:

| Path | To |
|---|---|
| `/` | the static landing page (`landing.html`), never the SPA |
| `/assets/*` | the hashed build, immutable, 404 when missing |
| everything else | `index.html`, so React Router works |
| `/api/*` | the Hono api |
| `/ws*` | the Hono api (websocket) |
| `/oauth/*`, `/t/*`, `/u/*` | mailcore (OAuth, tracking pixel, unsubscribe) |
| `/health` | the proxy itself — the deploy pipeline checks this |

The rules live in `docker/Caddyfile`, and the SPA is baked into the same
image (`docker/Dockerfile`). The site address is an env var:

| | local | production |
|---|---|---|
| `SITE_ADDRESS` | `:80` (plain HTTP) | `mailburstly.openehsaan.com` (automatic HTTPS) |
| `HTTP_PORT` | `8080` | `80` (the compose default) |
| `HTTPS_PORT` | `443` | `443` (the compose default) |

So the local stack is the same image, the same Caddyfile and the same routes
as the VPS — only the address differs. Locally `.env` carries the values
above (`.env.example` is the template); on the server it carries:

```bash
SITE_ADDRESS=mailburstly.openehsaan.com
```

That one line is what turns on the automatic certificate and the
http → https redirect. The deploy pipeline then checks
`https://mailburstly.openehsaan.com/health`.

Other commands:

```bash
bun run typecheck      # tsc, no emit
bun run build          # production bundle
bun run --filter '@mailrung/web' smoke   # headless render check on every route
```

The smoke script drives the installed Google Chrome via Playwright, visits every
route **in both dark and light themes**, fails on any console error or theme
mismatch, checks light-mode contrast ratios, and writes screenshots to
`/tmp/shots/<theme>-<route>.png`.

### Mailcore — the mail gateway

Mailcore owns everything protocol-shaped: OAuth2 consent, IMAP/SMTP transport,
the Gmail API and Microsoft Graph, the tracking pixel, and the webhook events
the worker consumes. It speaks the same REST contract the api, the worker and the
dispatcher already called, so none of them changed shape.

The cutover is two variables:

```bash
MAILCORE_API_URL=http://mailcore:3004
MAILCORE_API_TOKEN=<the token mailcore expects>
```

The worker receives mail events over the same path it always did
(`/webhooks/mailcore`), signed with an HMAC key — `MAILCORE_WEBHOOK_SECRET` on
both sides. A mismatch silently rejects every mail event.

Check what mailcore knows:

```bash
TOKEN=$(grep MAILCORE_API_TOKEN .env | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3004/v1/accounts | jq '.accounts[] | {email, type, state}'
```

**Test a mailbox end to end** from the web app: Mailboxes → **Test send** on the
mailbox card → send to `haroon@yopmail.com`. The modal returns the Message-ID
that was recorded.

### Microsoft (Outlook / M365) mailboxes

Mailcore runs the Microsoft consent flow itself and talks **Microsoft Graph**
(`Mail.ReadWrite`, `Mail.Send`, `User.Read`, plus `offline_access` for the
refresh token). One app registration in Entra, no second registration step.

[Entra admin center](https://entra.microsoft.com) → App registrations → New
registration.

| Setting | Value |
|---|---|
| Supported account types | Accounts in any organizational directory and personal Microsoft accounts (matches the `common` authority) |
| Redirect URI (Web) | `http://localhost:8080/oauth/callback` locally, `https://<host>/oauth/callback` in production |
| API permissions (delegated) | `Mail.ReadWrite`, `Mail.Send`, `User.Read` (Graph) |

Then **Certificates & secrets → New client secret** and copy the *value* (it is
shown once). Put both values in `.env`:

```bash
MICROSOFT_CLIENT_ID=aa666337-…
MICROSOFT_CLIENT_SECRET=…
```

and restart mailcore (`docker compose up -d --build mailcore`). Mailboxes →
Connect mailbox → Microsoft now goes straight to the Microsoft consent screen.

> **Sender display name.** Exchange resolves the name a recipient sees from the
> mailbox's Azure AD display name, not from ours. Set it in **Microsoft 365
> Admin Center → Recipients → Mailboxes → <address> → General → Display name**.
> The name we store on the mailbox is what Gmail and IMAP/SMTP mailboxes show.

### Google (Gmail) mailboxes

The Google OAuth app is registered against `https://<host>/oauth/callback`, the
same redirect as Microsoft, with the scopes `openid email profile` and
`https://www.googleapis.com/auth/gmail.modify`.

Two things to know before shipping it:

- **Never ship an app left in "Testing".** Google issues refresh tokens that
  expire after **7 days**, so every mailbox would die weekly. Publish the app.
- **Internal vs external.** If the operators are on your Google Workspace
  domain, set the user type to **Internal**: no verification, no CASA, no
  100-user cap. Personal `@gmail.com` accounts need an **external** app —
  published and unverified is enough for a small internal tool (a warning screen
  and a 100-user cap), but selling it to strangers means full verification plus
  a **CASA Tier 2** assessment (2–3 weeks, $500–$4,500, every 12 months).

Full details, including the verification checklist, are in
[mailcore.md](./mailcore.md) §16.

### IMAP/SMTP mailboxes (Spaceship and others)

Bought mailboxes are plain IMAP + SMTP. Mailboxes → Connect mailbox → **IMAP/SMTP
(manual)** asks for both server blocks and verifies them before registering the
account:

| | IMAP | SMTP |
|---|---|---|
| Host | `mail.spacemail.com` | `mail.spacemail.com` |
| Port | 993 | 465 (SSL) or 587 (STARTTLS) |
| Security | SSL | SSL / STARTTLS |
| Username | the full address | the full address |
| Password | the mailbox password | the mailbox password |

The api calls `/v1/verifyaccount`, which dials both servers for real, and
refuses the account if either fails. From then on mailcore polls IMAP every
30 s and delivers new mail to the worker as `messageNew`.

## Structure

```
apps/web/
├── src/
│   ├── main.tsx              entry: QueryClient + Router
│   ├── App.tsx               route table
│   ├── index.css             design tokens + Tailwind theme
│   ├── types.ts              domain types (mirror packages/shared later)
│   ├── lib/
│   │   ├── api.ts            typed fetch wrapper, mock switch
│   │   ├── query-client.ts   TanStack Query defaults
│   │   ├── format.ts         number / date / currency formatting
│   │   └── cn.ts             class merge
│   ├── components/
│   │   ├── layout/           AppShell, Sidebar, Topbar, Page
│   │   ├── ui/               Button, Badge, Card, Input, Table, Modal,
│   │   │                     Switch, Stat, Feedback, status helpers
│   │   └── charts/           AreaChart + Sparkline
│   ├── pages/                one file per route
│   └── mocks/data.ts         deterministic seed dataset
├── public/
│   ├── favicon.svg           the mark on its charcoal plate
│   ├── mail-burstly-lockup.svg  the full lockup: mark + "mail burstly"
│   ├── mail-burstly-mark.svg    the mark alone
│   ├── fonts/               Poppins woff2, self-hosted (the logo typeface)
│   └── landing.html          the public home page, served at "/"

docker/
├── Dockerfile                bun build (web) → Caddy: one edge image
└── Caddyfile                 the routes: SPA + /api + /ws + mailcore
```

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/` | Public home page | Static (`public/landing.html`), no login: what Mail Burstly is, what it does, the privacy policy |
| `/dashboard` | Dashboard | Today's KPIs, 30-day dual-axis trend, attention queue, active campaigns, activity feed, opportunities |
| `/campaigns` | Campaigns | Status filters, search, per-campaign reply rate, pipeline, progress |
| `/campaigns/:id` | Campaign detail | Tabs: Sequence (a real editor — steps, A/Z variants, delays, preview, test send), Leads, Analytics, Settings, plus the diagnosis |
| `/inbox` | Unibox | Folder rail (primary, unread, reminders, scheduled, sent, others, archived), conversation list, threaded view, inline reply, scheduled replies, reminders, macros, attach-lead |
| `/leads` | Leads | Multi-filter, bulk selection, add to a list, verification badges, owner assignment |
| `/lists` | Lists | Reusable contact collections: create, rename, duplicate, delete, add and remove members, attach to a campaign |
| `/mailboxes` | Mailboxes | Per-inbox health, quota consumption, tag filter, error surfacing |
| `/analytics` | Analytics | The funnel, daily chart, campaign table, per-mailbox metrics, activity log with filters, CSV export, auto-pause rules |
| `/settings` | Settings | Workspace, sending defaults, **the reply-classification model**, AI, verification, **alert recipients**, team |

## Alerting

When something breaks — above all when the system fails to send an email —
an alert goes to the addresses in the `alert_recipients` table.

Resend is the transport, and deliberately so: it is a completely separate
provider from the mail gateway we send campaigns through, so the alert still
goes out when the gateway is the thing that broke.

### Who gets told

The recipient list lives in the database, not in the environment:

```sql
SELECT email, name, severity, enabled FROM alert_recipients;
```

| Column | Meaning |
|---|---|
| `email` | The address. Unique per workspace. |
| `name` | An optional label, so the dashboard can say who this is. |
| `severity` | The **lowest** severity this address wants: `warning` means "tell me everything", `error` means "only when it is broken". |
| `enabled` | Soft off, so an address can be paused without losing its row. |

Manage it in the dashboard under **Settings → Alert recipients**, or through
the api:

```
GET    /api/alert-recipients
POST   /api/alert-recipients            { email, name?, severity?, enabled? }
PATCH  /api/alert-recipients/:id        { name?, severity?, enabled? }
DELETE /api/alert-recipients/:id
POST   /api/alert-recipients/:id/test   send a test alert to this address
```

`bun run db:seed` creates the first one (`ALERT_RECIPIENTS`, comma
separated) so a fresh database is not silent.

An **error** reaches every recipient; a **warning** only reaches the ones
that asked for warnings.

### What raises an alert

| Component | Alert |
|---|---|
| Dispatcher | a campaign email could not be sent · jobs could not be claimed · a failure could not be recorded · Postgres unreachable |
| Worker | a scheduled reply could not be sent · the mail gateway reported a delivery failure (`messageFailed` / `messageDeliveryError`) · the scheduler tick, aggregation, subsequence or auto-pause run failed · a webhook could not be processed · the health check failed |
| Api | the mail gateway could not be reached or refused a request · a reply or test send failed · an unhandled error · Postgres unreachable |

The delivery-failure webhook matters most: it used to be acknowledged and
dropped, which meant a mailbox whose credentials had expired sent nothing
and said nothing at all.

Each alert carries a key — `dispatcher.submit_failed`,
`worker.message_failed`, `api.reply_send_failed` — which is what the
deduplication counts and what you will see in the logs.

### Not a mail flood

- **One email per kind of failure per cooldown** (5 minutes by default). A
  campaign that fails five hundred times produces one email.
- The next email says how many were folded into it ("this happened 4 more
  times"), so a collapse never hides a storm.
- A hard cap of 20 alert emails an hour, across every kind of failure.
- The alerter never throws into the code that raised it, and a failed alert
  is logged rather than alerted about.

### Configuration

```
RESEND_API_KEY=          the Resend api key; empty disables alerting
ALERT_FROM_EMAIL=        the verified sender, e.g. alerts@mail.ehsaanlabs.com
ALERT_ENABLED=           false mutes alerting without removing the key
ALERT_COOLDOWN_MS=       300000 — how long one kind of failure stays quiet
ALERT_MAX_PER_HOUR=      20 — the flood ceiling
```

The key must be scoped to the sending domain, or Resend refuses to send from
it.

### Checking it

```
bun run verify:alerts             # sends a real alert through Resend
bun run verify:alert-recipients   # the api: list, add, update, test, remove
```

Both send to `haroon@yopmail.com` by default (`TEST_RECIPIENT` overrides it) —
the sanctioned sink for a test send. The live recipient list is never touched.

## Swapping mocks for the real API

`src/lib/api.ts` already carries a typed `api.get/post/patch/delete` client.
When the Hono api exists:

1. Set `VITE_API_URL` (defaults to `/api`, proxied by Vite in dev and by Caddy in prod).
2. Set `VITE_USE_MOCKS=false`.
3. Replace the direct `mocks/data.ts` imports in each page with
   `useQuery({ queryKey, queryFn: () => api.get(...) })`.

No component needs to change — the pages consume plain typed props today.

## Design notes

- **Semantic tokens only.** Components reference `--fg`, `--surface`, `--accent`,
  never a raw Tailwind palette colour. Theme changes are one file.
- **The palette is the logo's.** The accent is the lime from the wordmark
  (`#bdf972`, `oklch(0.914 0.176 129)`), and the neutrals are the artwork's
  charcoal and off-white rather than a generic blue-grey. The light theme
  uses a deeper green of the same hue, because lime text on a near-white
  surface does not clear contrast. Every text/surface pair is checked against
  WCAG before it ships.
- **Both themes are first-class.** The smoke test runs every route in dark and
  light, and asserts contrast: body 16:1, muted 5.1:1, subtle 3.1:1 in light.
- **Dual-axis charts.** Replies are ~3% of sends; sharing one axis flattens them
  into a straight line. Series can opt into a right-hand scale via `axis: "right"`.
- **Sent mail never shows raw tokens.** The sequence editor keeps `{{variables}}`
  because that is a template; anything rendered as a delivered message substitutes
  against the lead's data.
- **The reply-rate benchmark is a setting, not a constant.** Tables colour a
  campaign green at or above the workspace threshold (`Settings → Reply-rate
  benchmark`), persisted in `localStorage` via `PreferencesProvider`. When the
  api lands this moves to `workspaces.settings`.
- **Pipeline from a paused campaign is marked "at risk".** It still counts, but
  it is rendered muted with an amber label so it is not read as healthy pipeline.
- **Long tables paginate.** Leads pages at 25/50/100 rows with select-all scoped
  to the visible page. The mock uses offset paging; the real api will use a
  cursor, and only the page-fetch function changes.

## Next

M6 — the AI layer: LLM-backed reply classification with feedback, reply
suggestions, campaign templates, DNS/blacklist checks and `List-Unsubscribe`.
The M6 hooks are already in place: `LLM_PROVIDER` / `LLM_API_KEY` /
`LLM_MODEL` are read by the worker, and the classifier in
`apps/worker/src/components/events/classify.ts` is a pure function that an
LLM pass can sit behind.
