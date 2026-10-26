# Mailrung

Internal cold-email campaign runner. Instantly-shaped, scoped for 2–3 internal
operators, warmup deliberately deferred.

- **[PRD.md](./PRD.md)** — what the product does
- **[architecture.md](./architecture.md)** — how the system is built and wired
- **[mailcore.md](./mailcore.md)** — plan for replacing EmailEngine with
  `apps/mailcore` (the trial expires 2026-11-06)

## Status

**M1–M5 complete.** The full stack runs on one VPS via Docker Compose. A cold
email goes out with its variables rendered, the reply comes back, gets
classified, and lands in the inbox and the analytics.

| Layer | Runtime | State |
|---|---|---|
| `apps/web` | React 19 + Vite + Tailwind v4 | Dashboard, Campaigns, Campaign detail, Leads, Mailboxes, **Inbox** and **Analytics** wired to the real API. Lists and Settings still on mock data. |
| `apps/api` | Bun + Hono + Drizzle | Auth, mailboxes, campaigns, leads, inbox, analytics, webhooks, api keys, subsequences, public API. |
| `apps/worker` | Bun + BullMQ | Scheduler tick (send windows, stop conditions, blocklist), EmailEngine webhook intake (replies, bounces, opens, clicks, unsubscribes), daily aggregation, outbound webhook delivery, subsequence runner. |
| `apps/dispatcher` | Go | Claims `send_jobs` with `FOR UPDATE SKIP LOCKED`, renders the template, applies pacing/quota/jitter, submits to EmailEngine, records the Message-ID. |
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
bun run verify:events     # the EmailEngine webhook pipeline, against a live stack
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
self-hosted EmailEngine. See `architecture.md`.

## Quick start

```bash
bun install
bun run dev            # http://localhost:5173
```

Or the whole stack, which is what the VPS runs:

```bash
cp .env.example .env   # then fill in EMAILENGINE_API_TOKEN
docker compose up -d --build
open http://localhost:8080
```

Login: `admin@example.com` / `change-me-admin-password` (seeded).

To point the web app at the real API instead of the mock dataset, build it with
`VITE_USE_MOCKS=false` (the compose default) or run Vite with that env var.

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

### EmailEngine configuration

The worker receives EmailEngine's webhooks. Configure them once:

```bash
TOKEN=$(grep EMAILENGINE_API_TOKEN .env | cut -d= -f2)
SECRET=$(grep EMAILENGINE_SERVICE_SECRET .env | cut -d= -f2)

curl -X POST http://localhost:3003/v1/settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"serviceUrl\": \"http://localhost:3003\",
    \"webhooks\": \"http://worker:3002/webhooks/emailengine\",
    \"webhooksEnabled\": true,
    \"webhookEvents\": [\"messageNew\",\"messageSent\",\"messageBounce\",\"messageComplaint\",\"trackOpen\",\"trackClick\",\"listUnsubscribe\"],
    \"notifyText\": true,
    \"notifyHeaders\": [\"in-reply-to\",\"references\",\"from\",\"to\",\"subject\",\"message-id\",\"auto-submitted\",\"precedence\"],
    \"serviceSecret\": \"$SECRET\"
  }"
```

`webhookEvents` has no default — nothing is delivered until it is named.
`serviceSecret` is the HMAC key the worker verifies `X-EE-Wh-Signature`
against, so it must match `EMAILENGINE_SERVICE_SECRET` in `.env`.

### Microsoft (Outlook / M365) mailboxes

EmailEngine owns the Microsoft conversation too: it runs the consent flow,
holds the refresh token and talks Graph or IMAP. Our api never speaks
Microsoft OAuth — it only tells EmailEngine *which* OAuth app to use
(`MICROSOFT_OAUTH_APP_ID`, an EmailEngine app id, not the Entra client id).

Two steps, in this order.

**1. An app registration in Entra.** [Entra admin center](https://entra.microsoft.com)
→ App registrations → New registration.

| Setting | Value |
|---|---|
| Supported account types | Accounts in any organizational directory and personal Microsoft accounts (matches the `common` authority) |
| Redirect URI (Web) | `http://localhost:3003/oauth` locally, `https://<host>/oauth` in production |
| API permissions (delegated) | `Mail.ReadWrite`, `Mail.Send`, `User.Read` (Graph) — plus `offline_access` for the refresh token |

Then **Certificates & secrets → New client secret** and copy the *value* (it
is shown once). Put both values in `.env`:

```bash
MICROSOFT_CLIENT_ID=aa666337-…
MICROSOFT_CLIENT_SECRET=…
```

**2. Register the app with EmailEngine.** This is what creates
`MICROSOFT_OAUTH_APP_ID`:

```bash
bun run setup:microsoft          # add --dry-run to see the request first
```

The script registers (or updates, if one exists) the Outlook OAuth2 app in
EmailEngine and writes the app id it returns into `.env` as
`MICROSOFT_OAUTH_APP_ID`. Then:

```bash
docker compose up -d api         # the api reads the app id at boot
```

Mailboxes → Connect mailbox → Microsoft now goes straight to the Microsoft
consent screen, because the api passes the app id to EmailEngine's auth form
as `type`. Without it, EmailEngine shows a provider picker instead.

**`imap` vs `api`.** `baseScopes` decides how EmailEngine reads the mailbox:

- `imap` (default) — IMAP/SMTP with OAuth2. Works anywhere, including
  localhost, but it polls. Needs the Exchange Online delegated permissions
  (`IMAP.AccessAsUser.All`, `SMTP.Send`) on the app registration.
- `api` — Microsoft Graph. Push notifications instead of polling, but Graph
  rejects a change-notification URL that is not public HTTPS, so the account
  connects and then never syncs behind a plain-HTTP host. Use it only when
  EmailEngine is reachable over HTTPS.

Check what a connected account is doing:

```bash
TOKEN=$(grep EMAILENGINE_API_TOKEN .env | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3003/v1/accounts | jq '.accounts[] | {email, type, state, syncTime}'
```

`syncTime` moving means the mailbox is actually being read.

**Planned: EmailEngine on public HTTPS.** Graph push notifications need a
public HTTPS callback, and Graph refuses an `http` notification URL, so the
Outlook app falls back to polling. When the stack gets a public name, the
fix is:

1. **DNS + TLS.** An A record for the mail host → the VPS, and a reverse
   proxy (Caddy, or nginx + certbot) terminating 443 and proxying to
   `emailengine:3000`. Only EmailEngine needs a public name for this; the
   app itself keeps its own.
2. **Point EmailEngine at it.** `serviceUrl` (or the `notificationBaseUrl`
   override) becomes `https://<mail-host>`, which makes the Graph
   notification URL `https://<mail-host>/oauth/msg/notification?account=…`.
   It lives in the `settings` hash, so it survives restarts:

   ```bash
   curl -X POST http://localhost:3003/v1/settings \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d "{\"serviceUrl\": \"https://<mail-host>\", \"notificationBaseUrl\": \"https://<mail-host>\"}"
   ```

3. **The compose env.** `EMAILENGINE_PUBLIC_URL=https://<mail-host>` sets
   `EPUBLIC_URL` and `EHOST_URL`, which is what the hosted auth form and
   the consent redirect use. `PUBLIC_URL` (our own app) should be the
   public https URL of the web app too — it is what the OAuth callback
   points at.
4. **The Entra app.** Add `https://<mail-host>/oauth` as a second redirect
   URI (keep the localhost one for development).
5. **Reconnect the Outlook mailbox.** The current subscription is in an
   error state; a fresh consent registers the new https URL. Then check
   that `outlookSubscription.state` is `valid` and `syncTime` moves.


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
├── public/favicon.svg
├── Dockerfile                bun build → nginx
└── nginx.conf                SPA fallback + /api and /ws proxy
```

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/` | Dashboard | Today's KPIs, 30-day dual-axis trend, attention queue, active campaigns, activity feed, opportunities |
| `/campaigns` | Campaigns | Status filters, search, per-campaign reply rate, pipeline, progress |
| `/campaigns/:id` | Campaign detail | Tabs: Sequence (a real editor — steps, A/Z variants, delays, preview, test send), Leads, Analytics, Settings, plus the diagnosis |
| `/inbox` | Unibox | Folder rail (primary, unread, reminders, scheduled, sent, others, archived), conversation list, threaded view, inline reply, scheduled replies, reminders, macros, attach-lead |
| `/leads` | Leads | Multi-filter, bulk selection, add to a list, verification badges, owner assignment |
| `/lists` | Lists | Reusable contact collections: create, rename, duplicate, delete, add and remove members, attach to a campaign |
| `/mailboxes` | Mailboxes | Per-inbox health, quota consumption, tag filter, error surfacing |
| `/analytics` | Analytics | The funnel, daily chart, campaign table, per-mailbox metrics, activity log with filters, CSV export, auto-pause rules |
| `/settings` | Settings | Workspace, sending defaults, **the reply-classification model**, AI, verification, team |

## Swapping mocks for the real API

`src/lib/api.ts` already carries a typed `api.get/post/patch/delete` client.
When the Hono api exists:

1. Set `VITE_API_URL` (defaults to `/api`, proxied by Vite in dev and nginx in prod).
2. Set `VITE_USE_MOCKS=false`.
3. Replace the direct `mocks/data.ts` imports in each page with
   `useQuery({ queryKey, queryFn: () => api.get(...) })`.

No component needs to change — the pages consume plain typed props today.

## Design notes

- **Semantic tokens only.** Components reference `--fg`, `--surface`, `--accent`,
  never a raw Tailwind palette colour. Theme changes are one file.
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
