# Mailrung — Product Requirements Document

**Internal cold-email campaign runner.** Instantly-shaped, scoped for 2–3 internal users, warmup deferred.

| | |
|---|---|
| **Working name** | Mailrung |
| **App domain** | `mailrung.com` (Cloudflare Registrar, $10.46/yr) — *optional, not required for internal use* |
| **Status** | Draft v1 |
| **Date** | 2026-10-22 |
| **Users** | 2–3 internal operators |

---

## 1. Summary — headlines only

> Full detail for each item is in §3. Read this section for the shape of the product.

1. **Mailbox connection** — connect Gmail/Outlook/any IMAP-SMTP mailbox; see per-mailbox health and daily quota.
2. **Lead import** — upload CSV or a Google Sheet; map columns to variables; dedupe on import.
3. **Lead lists** — reusable, named, searchable contact lists with custom fields.
4. **Campaign builder** — multi-step email sequences with subject, HTML/text body, and merge variables.
5. **Personalization** — merge variables, fallback values, Spintax, and Liquid conditionals.
6. **A/Z variants** — per-step subject/body variants with weighted split and auto-optimize.
7. **Send scheduling** — send windows by day/time/timezone, daily campaign cap, per-mailbox cap.
8. **Sending rules** — stop on reply, stop on auto-reply, stop on company, max new leads per day.
9. **Account rotation & pacing** — round-robin across mailboxes with min-gap and random jitter.
10. **Bounce & suppression** — hard/soft bounce handling, global blocklist, per-lead suppression.
11. **Auto-pause on poor health** — campaign pauses itself when bounce rate crosses threshold.
12. **Unified inbox** — every reply from every mailbox in one thread view; reply without leaving the app.
13. **AI reply classification** — auto-tag replies Interested / Not Interested / OOO / etc.
14. **Lead status pipeline** — built-in + custom statuses carrying positive/neutral/negative interest.
15. **Opportunities** — mark a lead as an opportunity, attach a $ value, track conversions.
16. **Out-of-office handling** — detect OOO, auto-resume the sequence on the stated return date.
17. **Conditional follow-up sequences** — trigger a follow-up on a status, activity, or keyword.
18. **Analytics** — per campaign, per step, per variant, per mailbox; activity log; CSV export.
19. **Email verification** — bulk verify imported leads, quarantine invalid/risky addresses.
20. **Deliverability checks** — SPF/DKIM/DMARC status, blacklist monitoring, text-only sending mode.
21. **Reply suggestions & macros** — AI-drafted replies and saved templates for common replies.
22. **Webhooks & API** — outbound event webhooks and a REST API for external scripts.
23. **Campaign templates** — save and duplicate a working sequence as a template.
24. **Global preferences** — timezone, default limits, tracking toggles, AI toggles.

**Explicitly out of scope (v1):** warmup and the deliverability network, the 450M lead database / SuperSearch, SISR dedicated IPs, seed-based inbox placement testing, LinkedIn and multichannel, AI sales agent / autonomous prospecting, billing, plans, credits, and seat management.

---

## 2. Users & core loop

**Who:** 2–3 internal operators running outbound campaigns for clients (the ehsaantech GTM work already in the workspace). One operator may own a mailbox pool and run 5–20 concurrent campaigns.

**Core loop:**

```
Connect mailboxes  →  Import leads  →  Build sequence  →  Configure rules  →  Launch
                              ↑                                                       │
                              └──────────────  Iterate on analytics  ←──────────────┘
                                                        ↓
                                          Replies land in Unibox → tag status → reply
```

**Non-goal:** the system is not a CRM. It holds lead state relevant to outreach (status, owner, campaign) and nothing more.

---

## 3. Feature detail

### 3.1 Mailbox connection

**Goal.** Operators connect their own sending mailboxes; the system tracks each mailbox's health and enforces its own daily send quota.

**Behavior**
- Connect via Google OAuth2, Microsoft OAuth2, or raw IMAP/SMTP (host, port, user, password/app-password).
- On connect, run a **connection test**: SMTP `EHLO` + `MAIL FROM` probe (no message), IMAP `SELECT INBOX`, OAuth token exchange. Record result and error surface.
- Each mailbox has: `status` (connected / degraded / failed / disconnected), `daily_cap` (default 30, hard-max 50), `health_score` (0–100), `last_checked_at`.
- **Health score** = weighted blend of: bounce rate (30d), hard-bounce count, error rate on send, open rate, reply rate, and days since last successful send. Recomputed hourly. Below 40 → `degraded` → mailbox is automatically excluded from rotation.
- Mailbox **tags** (e.g. `client-acme`, `us-west`, `warm-tier-1`) for campaign targeting. A campaign selects mailboxes by explicit pick or by tag.
- **Daily quota** is per mailbox per calendar day in the workspace timezone. Sends beyond quota are deferred to the next eligible window, never dropped.
- Support `reply_to` override and per-mailbox display name / signature.
- OAuth token refresh is delegated to EmailEngine; we mirror `emailengine_account_id`.

**Data.** `mailboxes`, `mailbox_daily_stats`, `mailbox_health_events`.

**Edge cases.** OAuth consent revoked mid-campaign → mailbox flips to `failed`, campaign continues on remaining mailboxes, dashboard surfaces a banner. Gmail app-password revoked → same. Duplicate mailbox (same email connected twice) → blocked at connect time. A mailbox that was at quota and then had quota raised → resumes immediately.

**Acceptance.** Connect a Gmail account via OAuth in ≤5 clicks; a campaign assigned that mailbox sends via it; hitting the cap defers rather than drops.

---

### 3.2 Lead import

**Goal.** Get a clean, mapped, deduplicated contact list into a campaign in under a minute.

**Behavior**
- Sources: **CSV file upload**, **Google Sheets URL** (public sheet, read via Sheets API or CSV export), **manual paste** (newline or comma separated).
- **Column mapping UI:** auto-detect header names against a dictionary (`email`, `first_name`, `last_name`, `company`, `title`, `phone`, `website`, `linkedin`, `city`, `country`, `industry`, `notes`). Auto-match is a *suggestion*, always user-confirmable. Any unmatched column can be mapped to a **custom variable** (created on the fly) or marked "Do not import".
- `email` is the only required field. Rows missing/invalid email are rejected and reported with row numbers.
- **Dedupe** on normalized email (lowercase, strip `+tag`, strip dots in gmail local-part). Options: skip duplicates within the file, skip against existing workspace leads, or skip against the target campaign. Default: skip within file + against target campaign, allow across other campaigns.
- **Verification** runs in the background after import (see §3.19). Import completes first; results stream in.
- Import is **async and chunked** — a 100k-row CSV does not block the request. UI shows progress: `parsed → validating → inserting (n/m) → done`.
- Any column can be promoted to a lead's **custom field** stored as JSONB, usable in merge tags.

**Data.** `import_jobs`, `import_rows` (per-row validation result), `leads`, `lead_list_members`, `campaign_leads`.

**Edge cases.** 60MB CSV → chunked parse, no memory blowup. Header with 60 columns → works (we cap *suggested* variables at 50 but accept more). Sheet URL not public → explicit error, no silent empty import. Unicode/quoted fields/embedded newlines → correct RFC-4180 parsing. Re-importing the same file → all rows deduped, user told "0 new, 500 duplicates".

**Acceptance.** Import a 5,000-row CSV with 3 deliberately bad emails; user sees exactly which rows failed and why; a second identical import adds 0 leads.

---

### 3.3 Lead lists

**Goal.** Reusable, named contact collections that can be attached to campaigns and reused across them.

**Behavior**
- Create, rename, delete, duplicate a list. Lists hold leads; a lead may be in many lists.
- Attach a list to a campaign → all its leads become campaign members, unless suppressed/blocked.
- A lead added to an attached list *after* campaign launch is **auto-enrolled** (configurable per campaign: enroll-on-add vs. snapshot-at-launch).
- List view shows: total, by status, by source, by owner, last activity. Filter and sort on any column.
- Bulk actions: assign owner, set status, add to another list, export CSV, delete.
- Export includes predefined fields + all custom variables.

**Data.** `lead_lists`, `lead_list_members`, `leads`.

**Edge cases.** Deleting a list must not delete leads. Deleting a lead removes it from all lists and campaigns. A lead on the blocklist is filtered out of enrollment automatically.

**Acceptance.** Create a list, attach to a running campaign, add a new lead; it gets enrolled on the next campaign step and appears in campaign analytics.

---

### 3.4 Campaign builder

**Goal.** Define the multi-step email sequence a lead will walk through.

**Behavior**
- A campaign has an ordered list of **steps**. Each step holds:
  - `subject` — required on step 1; on later steps, leaving it blank means "reuse previous subject" (reply-threaded follow-up).
  - `body` — rich text (HTML) and/or plain text. Editor supports bold/italic/underline, lists, links, images, and a raw-HTML mode.
  - `preheader` — optional, the inbox preview snippet.
  - `delay` — the wait *before this step* is sent, expressed in days / hours / minutes. Step 1 has no delay (fires on enrollment). The delay is measured from the previous step's send time.
  - `thread_mode` — `reply` (same subject, `In-Reply-To`/`References` set → true threading) or `new_thread`.
  - `variants[]` — 1..n A/Z variants (§3.6).
- Steps can be inserted, reordered, duplicated, deleted, and added to a **live** campaign (existing leads already past that step are unaffected).
- **Preview**: render the step for a chosen lead with all variables substituted; send a test email to arbitrary addresses from a chosen mailbox.
- **Templates**: save any step or a whole sequence as a reusable template; apply to another campaign.
- Campaign **draft → active → paused → completed** lifecycle. Creating a campaign never sends. Launch is a separate explicit action.

**Data.** `campaigns`, `campaign_steps`, `step_variants`, `sequence_templates`.

**Edge cases.** A step with an empty body and empty subject is rejected at launch. Reordering steps must not corrupt in-flight lead state (leads keep their own `current_step` index by step id, not position). Deleting a step that in-flight leads have already passed → they skip to the next available step.

**Acceptance.** Build a 3-step sequence, preview step 2 with a lead that has `first_name=Jane` and `company=Acme` → correct substitution; test email arrives threaded under the step-1 subject.

---

### 3.5 Personalization (variables, Spintax, Liquid)

**Goal.** Make every email read as if it was written for that one lead.

**Behavior**
- **Merge variables** in subject and body: `{{first_name}}`, `{{company}}`, or any custom variable `{{pain_point}}`. Insert via picker in the editor.
- **Fallback values** per variable: if the lead lacks the value, substitute a configured default (e.g. `{{first_name|there}}` → "there"). Never emit a raw `{{token}}` to a recipient.
- **Spintax**: `{Choice1|Choice2|Choice3}` — a random option is selected **per send**, and the choice is recorded so analytics can attribute per-variant performance. Nested spintax supported. A "Generate with Spintax" helper can wrap sentences automatically.
- **Liquid**: `{% if company %}…{% else %}…{% endif %}`, `{% unless %}`, `{% case %}`, `{{ variable | default: "x" }}`. If parsing fails, fall back to the plain-text body and flag the step in the UI rather than failing the send.
- **Default variable set** always available: `email`, `first_name`, `last_name`, `company`, `title`, `city`, `country`, `industry`, `current_date`, `campaign_name`, `sender_name`.
- Missing-variable counter surfaced in the editor ("2 of 40 leads lack `pain_point`").

**Data.** `campaign_steps.variables` (declared), `leads.custom_variables` (JSONB), `campaign_leads.render_cache`.

**Edge cases.** Lead's value is an empty string vs. `NULL` — empty string should trigger the fallback. A value containing HTML must be escaped in the HTML body but *not* escaped in the plain-text body. Unbalanced Liquid tags → editor warning, safe fallback at send time.

**Acceptance.** A lead missing `company` receives the configured fallback, not an empty gap and not a literal `{{company}}`.

---

### 3.6 A/Z variants

**Goal.** Test subject lines and bodies within one campaign and automatically favor the winner.

**Behavior**
- Each step may have multiple variants. Each variant has its own subject and body and a **weight** (percentage of traffic).
- **Assignment is sticky per lead**: once a lead is assigned a variant for a step, all future sends of that step to that lead use the same variant. (Re-randomizing per send destroys attribution.)
- **Auto-optimize**: after a minimum sample size (default 30 sends per variant, configurable), the engine selects the winning variant by the chosen metric (reply rate default; click rate and open rate selectable) and shifts traffic to it. Traffic shifts gradually (e.g. 10% per hour) rather than instantly.
- Per-variant analytics: sent, opened, clicked, replied, positive replies, opportunities.
- Manual override to pin traffic 100% to a variant.

**Data.** `step_variants` (weight, pinned), `campaign_leads.variant_assignments` (JSONB: `{step_id: variant_id}`), `variant_stats`.

**Edge cases.** Auto-optimize must not fire on a sample that's too small or too noisy — require a minimum sample *and* a minimum absolute difference, else stay neutral. Two variants with near-identical reply rates → keep the split.

**Acceptance.** A step with 2 variants at 50/50 assigns a lead to one variant and keeps it there across follow-ups.

---

### 3.7 Send scheduling

**Goal.** Send only when a human would be reading, and never exceed safe daily volume.

**Behavior**
- **Schedules** per campaign: a list of schedule rules, each with days-of-week, a start time, an end time, and a **timezone**. Multiple rules are allowed (e.g. "US West 9–11 & 14–16", "US East 9–11").
- Schedule modes: `always` (24/7), `office_hours` (derived from a workspace default), `custom` (explicit rules).
- **Daily campaign limit**: total emails the campaign may send per day, summed across mailboxes. Exceeding it defers to the next window.
- **Per-mailbox daily limit**: default 30 (hard cap 50 — configurable globally, not per campaign).
- **Max new leads per day**: caps how many *step-1* sends occur per day, independently of follow-up volume. Useful to control list burn.
- **Time gap between emails** (per mailbox, global default): minimum 9 minutes, plus a random additional 0–5 minutes. Jitter is applied per send, not per campaign.
- All limits are evaluated in the **workspace timezone** for the daily boundaries; send windows are evaluated in each schedule rule's own timezone.
- DST transitions handled by storing schedule rules in IANA tz and computing with a proper tz library.

**Data.** `campaigns.schedule` (JSONB), `campaigns.daily_limit`, `campaigns.daily_max_leads`, `schedules` (normalized table, one row per rule).

**Edge cases.** A schedule window that ends before it starts (crosses midnight) → treat as wrapping to next day. Friday 17:00 + 3-day delay = Monday (or Tuesday if Monday is excluded by the schedule). A campaign with no matching window for 3 days → leads sit in `waiting`, progress bar reflects it, no sends.

**Acceptance.** A campaign limited to 30/day with 2 mailboxes at cap 30 sends exactly 60 on day 1 and 0 on day 2 until the window reopens.

---

### 3.8 Sending rules

**Goal.** Decide when to *stop* emailing a lead, automatically.

**Behavior**
Toggles per campaign:
- **Stop on reply** — any reply from the lead stops all remaining steps. (Default ON.)
- **Stop on auto-reply** — an automatic response (OOO, autoreponder) stops the sequence. (Default OFF, because §3.16 OOO auto-resume is the better behavior.)
- **Stop for company** — when any lead at a company replies, all other leads at that same company domain are marked completed. Auto-replies do **not** trigger this.
- **Stop on bounce** — hard bounce removes the lead from all campaigns and adds them to the blocklist. (Always on, not configurable.)
- **Stop on unsubscribe** — an unsubscribe link click or a complaint removes them globally.
- **Max new leads per day** — see §3.7.
- **Prioritize new leads over follow-ups** — optional; reverses the default (follow-ups first) so the top of the funnel keeps moving.

**Data.** `campaigns.sending_rules` (JSONB), `campaign_leads.state` (`active|stopped|completed|suppressed|paused`), `campaign_leads.stopped_reason`.

**Edge cases.** A lead who replies and then unsubscribes → both recorded, unsubscribe wins on the blocklist. Stop-on-reply triggered by a *bounce-like* auto-response must not fire. A lead stopped by a company rule still shows their individual history.

**Acceptance.** Lead A at `acme.com` replies interested; lead B at `acme.com` receives no further steps and shows `completed (company stop)`.

---

### 3.9 Account rotation & pacing

**Goal.** Spread volume across mailboxes so no single one is a spam signal, and never send two emails back-to-back.

**Behavior**
- Within a campaign, each send picks the **next healthy mailbox in round-robin**, skipping mailboxes that are degraded, failed, or at daily quota. If all are unavailable, the send is deferred to the next window and the campaign surfaces a diagnostic.
- **Round-robin state is per campaign** (not global) so campaigns don't collide on the same mailbox.
- **Minimum gap** between two sends *from the same mailbox* (default 9 min) plus random 0–5 min jitter.
- **One email per lead per window**: a lead cannot receive two campaign emails in the same sending window.
- **Global per-mailbox safety cap** — hard ceiling 50/day, not user-overridable above that.
- Per-mailbox send telemetry: last send time, sends today, next eligible time. Shown live in the dashboard.

**Data.** `campaign_leads.last_sent_at`, `mailbox_daily_stats`, `campaigns.rotation_cursor`.

**Edge cases.** A mailbox added mid-campaign joins the rotation at the current cursor position. A mailbox removed mid-campaign stops receiving immediately; in-flight sends to it are re-queued to another mailbox. All mailboxes at quota → campaign state `waiting`, not `failed`.

**Acceptance.** 3 mailboxes, 1,000-lead campaign, 90/day limit → each mailbox receives ~30/day, no two sends from the same mailbox within 9 minutes.

---

### 3.10 Bounce & suppression

**Goal.** Protect sender reputation by removing bad addresses before they do damage.

**Behavior**
- Classify every send result:
  - **Hard bounce** (5xx SMTP, or a known dead address) → mark lead `invalid`, remove from all campaigns, add to global blocklist, and count against the mailbox's health score.
  - **Soft bounce** (4xx) → retry with exponential backoff (3 attempts: 5min / 30min / 2h). If all fail, mark `risky`, do not auto-block.
  - **Success** → record and advance the lead.
- **Global blocklist** holds `email` entries and `domain` entries. Blocked emails are skipped on import and at send time. Blocked domains skip all addresses at that domain.
- Blocklist entries record a `source`: `manual`, `hard_bounce`, `unsubscribe`, `complaint`, `ai_blocklist` (auto-detected from reply content).
- **BounceShield / risky lead skip**: a lead previously seen to hard-bounce elsewhere is skipped by default.
- Manual "stop sending to this lead" sets a per-lead suppression that overrides campaign enrollment.
- Bounce analytics per campaign and per mailbox, with the reason and the campaign step that triggered it.

**Data.** `blocklist` (type, value, source, created_at), `bounces` (reason, code, step_id, mailbox_id), `leads.email_status` (`valid|invalid|risky|unknown`).

**Edge cases.** Blocklist check is a fast indexed lookup on the hot path — never a full scan. Domain blocklist matching must be suffix-aware (`acme.com` blocks `mail.acme.com` but not `notacme.com` — match on label boundary). A lead on the blocklist who is manually moved into a campaign is skipped with a visible reason, not silently.

**Acceptance.** A hard-bounced lead never receives step 2; the bounce is visible in campaign analytics with its reason.

---

### 3.11 Auto-pause on poor health

**Goal.** The campaign protects itself when something goes wrong, without a human watching.

**Behavior**
- Rules evaluated every 5 minutes against the trailing window:
  - **Bounce rule**: hard-bounce rate > 5% (after a minimum of 200 sends) → pause campaign.
  - **Error rule**: send error rate > 10% → pause campaign.
  - **Placement rule** (v2, when inbox-placement exists): placement < 80% after 300 sends → pause.
- A pause records the **reason** and the exact metric value, and notifies the operator (in-app + webhook).
- **7-day exemption**: after a manual resume, the same rule cannot re-trigger for 7 days.
- Manual resume clears the exemption only via explicit operator action, and the operator is prompted to re-verify the list first.
- A paused campaign can be edited (steps, rules, limits) and resumed.

**Data.** `campaign_health_events` (rule, metric, value, threshold, action), `campaigns.paused_reason`, `campaigns.paused_at`.

**Edge cases.** A campaign paused for bounce must not resume just because bounce rate fell (leads were removed). The diagnostic must explain *which* rule fired and *when*, so the operator can act.

**Acceptance.** Bounce rate crosses 5% → campaign stops sending within 5 minutes, dashboard shows the reason, resume works and the rule is suppressed for 7 days.

---

### 3.12 Unified inbox (Unibox)

**Goal.** Every reply from every mailbox, in one place, with a fast reply path.

**Behavior**
- One inbox across all connected mailboxes. Conversations grouped by thread, ordered by last activity.
- **Folders**: `Primary` (replies from known leads), `Unread`, `Reminders`, `Scheduled`, `Sent`, `Others` (replies from non-leads, e.g. someone forwarded it to us).
- **Filters**: by campaign, by mailbox, by lead status, by owner, by date, plus free-text search over subject *and body*.
- **Thread view**: full message history, our sends inline with the replies, and per-message metadata (received time, sending mailbox, campaign step, variant).
- **Reply from the app** — compose inline, send from the original sending mailbox, threaded correctly. Support **scheduled replies** (send at a chosen future time) and **reminders** (flag a conversation to revisit).
- **Macros** — saved reply templates with variable substitution, e.g. "send pricing sheet", "redirect to colleague", "book a call".
- **Attach Lead** — a reply in `Others` (from a forwarded email or a different address) can be manually linked to the original lead, moving it to `Primary` and stopping their sequence.
- **Non-lead email** can be ignored entirely (workspace preference: don't sync non-campaign mail).
- Real-time: new replies appear without a manual refresh (WebSocket).

**Data.** `conversations`, `messages`, `message_links` (to lead/campaign/step), `reminders`, `macros`, `scheduled_replies`.

**Edge cases.** A lead replying from a *different* address than we wrote to → lands in `Others`; attribution by conversation context, fall back to most-recent campaign; `Attach Lead` fixes it manually. A reply to a campaign we sent 3 months ago → still attributed, no duplicate thread. Concurrent opens of the same thread → read state syncs.

**Acceptance.** Two mailboxes receive replies to the same lead → both appear in one thread with the correct campaign attribution; reply sent from the app arrives in the lead's inbox threaded under our original subject.

---

### 3.13 AI reply classification

**Goal.** Triage replies automatically so the operator works the good ones first.

**Behavior**
- On each inbound reply, an LLM classifies it into one of the workspace's **lead statuses** and extracts a sentiment + a short summary.
- Built-in statuses available to the classifier: `Interested`, `Not Interested`, `Out of Office`, `Meeting Booked`, `Meeting Completed`, `Wrong Person`, `No Show`, `Lost`, `Won`.
- The operator can restrict which statuses the classifier may apply, and whether it may *overwrite* a manually-set status (default: do not overwrite manual).
- **Label descriptions** are the prompt context. The operator edits a label's description to steer the classifier.
- **Feedback loop**: a thumbs-up/down on a classification records the correction; corrections are logged for later prompt tuning and optional fine-tuning.
- **Confidence threshold**: below threshold → do not auto-apply; leave the conversation in a "needs review" state. A lead is never silently mislabeled as `Not Interested`.
- **Multi-language**: classifier handles non-English replies.
- Cost control: classification is one small model call per reply, with a cheap local heuristic pre-filter (a regex for OOO patterns, unsubscribe phrases) that short-circuits without an LLM call.

**Data.** `classifications` (message_id, status, confidence, sentiment, summary, model, feedback), `lead_labels` (definition), `leads.status`.

**Edge cases.** A reply containing both interest and an unsubscribe → unsubscribe wins (higher-priority rule). An auto-reply that is *not* OOO (a "we no longer monitor this inbox" notice) → `Others`, not a lead status. A reply that is spam → ignore, don't classify.

**Acceptance.** Ten varied replies land; each is auto-tagged with a plausible status; at least one low-confidence reply is left untagged for human review rather than mislabeled.

**As built.** The classifier is in `apps/worker/src/components/classification/`:

- A rule-based classifier short-circuits an out-of-office and an unsubscribe
  with no model call, and provides the fallback when no key is configured or
  the model fails.
- The model is Ollama's cloud. A **decision model** (`clef:27b`,
  $0.24/M input tokens, no output cost) uses `/v1/systemone`, which returns
  a probability per label and a real concentration score — that score is
  what the confidence threshold is compared against. Any other model uses
  `/v1/chat/completions` and returns free-form JSON.
- A model answer below the threshold applies no label; a confident rule
  result still stands in that case, so nothing is mislabeled.
- The label's description is the prompt context, and the label a reply maps
  to is the classifier's label, so editing a description steers it.
- **Not built yet:** the per-status allowlist, the thumbs-up/down feedback
  loop, and the `classifications` table — the current implementation writes
  `lead_status_events` instead.

---

### 3.14 Lead status pipeline

**Goal.** A simple pipeline that reflects where each lead actually is.

**Behavior**
- **Built-in statuses** (non-deletable): `Interested`, `Not Interested`, `Out of Office`, `Meeting Booked`, `Meeting Completed`, `Wrong Person`, `No Show`, `Lost`, `Won`.
- **Custom statuses**: name, description, and a fixed **interest** of `Positive` / `Neutral` / `Negative` (immutable after creation). The description doubles as classifier prompt context.
- A lead has exactly one active status. Changing status is manual or AI-driven (§3.13).
- Status transitions are recorded with timestamp, actor (`user` or `ai`), and source message.
- Status is filterable in the inbox, on the lead table, and in campaign analytics. **Only `Positive` statuses count as opportunities.**
- Built-in statuses cannot be deleted; custom ones can, and affected leads are reassigned to a chosen fallback.

**Data.** `lead_labels` (name, description, interest, is_builtin, use_ai), `leads.status_id`, `lead_status_events`.

**Edge cases.** Deleting a custom status must not orphan leads (reassign, don't null). A status change to `Not Interested` on one campaign does not affect a lead in another campaign — status is **per lead**, but the *event* records the campaign.

**Acceptance.** Create a custom status "Wants a demo" marked Positive; a lead tagged with it counts as an opportunity and appears in the Positive filter.

---

### 3.15 Opportunities

**Goal.** Convert a reply into a tracked, valued business outcome.

**Behavior**
- An **opportunity** links a lead + campaign, with a `status` (mirrors the lead's positive status), an optional **monetary value**, a `source` (manual or AI-detected), and a timestamp.
- **Positive reply rate** = opportunities ÷ replies. **Opportunity value** sums the attached $ amounts.
- **Conversions** = opportunities with status `Won` (or `Closed`), with their total $ value.
- Opportunity records are editable and deletable; edits are logged.
- Campaign analytics shows: opportunities, opportunity value, conversions, conversion value → this is the ROI number the operator actually reports.
- A lead can have multiple opportunities across campaigns.

**Data.** `opportunities` (lead_id, campaign_id, status, value, source, created_at, closed_at), `opportunity_events`.

**Edge cases.** Value is currency-aware (store minor units + ISO currency). A lead marked `Won` with no opportunity → the UI prompts to create one so ROI isn't silently understated.

**Acceptance.** Attach $5,000 to an interested lead; campaign analytics shows 1 opportunity and $5,000 value; marking it Won moves it to conversions.

---

### 3.16 Out-of-office handling

**Goal.** Don't burn a lead while they're on holiday, and don't forget them when they return.

**Behavior**
- Detect an OOO auto-reply. Extract the **return date** where present ("back on Jan 6", "returning 2026-01-06") using a date parser with a relative-date base.
- On detection: set the lead's status to `Out of Office`, set `pause_until = return_date`, and **suspend** their sequence. Follow-ups are not sent while paused.
- On `pause_until`, the lead is **auto-resumed**: the sequence continues from the next unsent step, with the delay measured from the resume moment.
- If no return date can be parsed → fall back to a configurable default pause (default 5 business days) and flag it for manual review.
- **Priority:** OOO pause/resume takes precedence over the "stop on auto-reply" rule — when OOO auto-resume is enabled, "stop on auto-reply" must be off (enforced with a clear warning in the UI).
- The operator can override the return date or resume early from the lead info popover.

**Data.** `leads.pause_until`, `campaign_leads.paused_until`, `ooo_events` (raw body, parsed date, confidence).

**Edge cases.** An OOO reply with a date in the past → ignore the date, use the default pause. A lead who replies OOO *and* the campaign was paused → both states are independent and resolve correctly. A second OOO reply while already paused → update the return date, don't stack.

**Acceptance.** Lead replies OOO "back Jan 6"; no further emails before Jan 6; on Jan 6 the sequence resumes with the next step.

---

### 3.17 Conditional follow-up sequences (subsequences)

**Goal.** Respond to what the lead *did*, not just on a fixed timer.

**Behavior**
- A **subsequence** is a secondary step sequence attached to a campaign, entered when its **trigger** matches.
- **Trigger types**:
  - **Status** — lead's status becomes one of the listed statuses (e.g. `Interested`).
  - **Activity** — email opened, link clicked, or campaign completed without reply.
  - **Keyword** — the reply contains one of the listed phrases (exact phrase match, `;`-separated).
- A triggered lead is **added to the subsequence**; the subsequence's own steps then run on their own schedule, inheriting the parent campaign's schedule unless overridden.
- The subsequence's first step may wait a configurable delay before firing.
- Each subsequence has its own daily limit: `inherit` (share the parent), `custom`, or `none`.
- Operators can also **manually move leads** into a subsequence from the campaign lead table.
- A lead already in a subsequence is not re-added (idempotent).
- **Guard:** a lead paused for OOO must not receive subsequence emails.

**Data.** `subsequences`, `subsequence_conditions` (type, values), `subsequence_steps`, `subsequence_members`.

**Edge cases.** A lead matching two subsequences → enters both, each with its own schedule and daily limit — but the combined volume must still respect the parent campaign's daily limit. A keyword trigger must match *phrases*, not substrings, to avoid false positives ("not interested" contains "interested"). A status trigger fires on the *transition*, not on every subsequent state.

**Acceptance.** A lead replies "send me more information"; the keyword subsequence fires and delivers the details email; a lead who replies "I am not interested" does **not** trigger an "interested" keyword subsequence.

---

### 3.18 Analytics

**Goal.** Answer "what is working" without exporting to a spreadsheet.

**Behavior**
- **Campaign-level metrics** (date-range filterable): sequence started, total sent, opened, clicked, replied, unique replies, reply rate, positive reply rate, opportunities, opportunity value, conversions, conversion value, bounce rate, complaint rate.
- **Step-level metrics**: per step — sent, opened, clicked, replied, positive replies, opportunities. This is what tells you which follow-up works.
- **Variant-level metrics**: per A/Z variant at the step level.
- **Mailbox-level metrics**: per sending mailbox — contacted, opened, replied, bounce rate, combined score. This is what tells you which mailbox is degrading.
- **Activity log**: an append-only event stream — `email_sent`, `email_opened`, `link_clicked` (with which link), `reply_received`, `auto_reply`, `bounced`, `unsubscribed`, `status_changed`, `subsequence_entered`. Filterable by any dimension; exportable to CSV.
- **Progress indicator**: % of leads who have completed the *entire* sequence (not each step). This mirrors the "progress" mental model users expect.
- **Diagnose**: a button that explains *why* a campaign isn't sending — `out_of_schedule`, `daily_limit_met`, `waiting_for_leads`, `all_accounts_unhealthy`, `campaign_draft`, `no_accounts_assigned`, `paused_by_rule`.
- **Auto-reply exclusion**: reply rate can exclude auto-replies, so OOO noise doesn't inflate the number.
- All reporting in **UTC** for consistency, with the workspace timezone shown alongside.

**Data.** `activities` (append-only, partitioned by month once volume warrants), `campaign_daily_stats`, `step_daily_stats`, `variant_daily_stats`, `mailbox_daily_stats`. Aggregates materialized on a schedule + on-demand recompute for the current day.

**Edge cases.** "Total sent" counts **emails**, not contacts. "Reply rate" = replies ÷ total sent; "unique replies" counts each lead once. Auto-replies included by default, excludable. Bounce reason must be retrievable per event, not just a count.

**Acceptance.** Campaign analytics distinguishes a step with high opens and no replies from one with a 4% reply rate, and the activity log explains each individual send.

---

### 3.19 Email verification

**Goal.** Keep invalid and risky addresses out of the sending pool.

**Behavior**
- **Provider**: integrate an external verification API (NeverBounce is already present in the workspace and is a good fit; the provider is behind an interface so it can be swapped). The system must work with a provider key supplied via workspace settings.
- **Bulk verification** runs automatically after an import, asynchronously, chunked, with progress shown in the UI.
- **Result classes** per lead: `valid`, `invalid`, `risky`, `catch_all`, `unknown`.
- **Invalid** → lead quarantined: not enrolled, not counted against send quota, appears in a "Rejected" list the operator can export.
- **Risky** → enrolled only if the campaign allows risky leads (default **off**). Skipped leads are reported with a count.
- **Cost control**: verification is opt-in per import, and the workspace can cap verifications per day. Verification results are cached by (email, provider) for 30 days so re-imports don't re-bill.
- **Individual verification** on demand from the lead record.
- **Role/address detection** flags `info@`, `admin@`, `support@` as risky by default — configurable.

**Data.** `verifications` (email, provider, result, score, checked_at, cached_until), `leads.email_status`, `leads.verification_score`.

**Edge cases.** Provider API down → import still succeeds, verification retries with backoff, leads sit in `unknown` and are *not* auto-sent until resolved (configurable to allow sending on `unknown`). A catch-all domain (`*@company.com` accepts anything) → `catch_all`, not `valid`; must not be reported as a bounce when it fails.

**Acceptance.** Import 1,000 leads; ~80 invalid ones are quarantined and never sent; a re-import within 30 days performs zero new API calls.

---

### 3.20 Deliverability checks

**Goal.** Catch the configuration mistakes that silently ruin sending.

**Behavior**
- **DNS check** per sending domain: SPF presence + record count (exactly one, ≤10 lookups, `~all` or `-all`), DKIM selector resolution + 2048-bit key, DMARC presence + policy + `rua` reporting address. Show a per-record pass/warn/fail and a copy-ready fix.
- **Alignment check**: the `From:` domain must align with SPF and DKIM domains or DMARC fails.
- **Blacklist monitoring**: check sending domains and IPs against a configurable list of blacklists (DNSBL via MX lookup). Results cached with a TTL.
- **Text-only sending mode**: per campaign, send MIME `text/plain` only — no HTML, no images, no tracking pixel. Deliverability-improving; also the mode to use if HTML rendering breaks.
- **Provider matching** *(optional, v1.5)*: prefer sending from a mailbox whose provider matches the recipient's (Gmail→Gmail, Outlook→Outlook). Requires both a matching mailbox and a fallback policy.
- **Unsubscribe header**: optionally add `List-Unsubscribe` (RFC 8058 one-click) to every message, using a per-campaign unsubscribe URL that records the opt-out.

**Data.** `domains`, `dns_records` (type, value, status, checked_at), `blacklist_checks`, `campaigns.text_only`, `unsubscribes`.

**Edge cases.** DKIM key rotation must not break a live campaign — a failing DKIM check should warn loudly but not auto-pause (bounce rule handles actual damage). DNSBL false positives are common → show the raw response so the operator can judge. `List-Unsubscribe` must be a real, working URL or providers penalize it.

**Acceptance.** A domain with two SPF records shows a clear fail with the two conflicting values and the fix.

---

### 3.21 Reply suggestions & macros

**Goal.** Cut the time from "a reply arrived" to "a good reply went out."

**Behavior**
- **Reply suggestions**: on opening a conversation, generate 1–3 draft replies from the message content + campaign context + the operator's product/positioning context. Drafts are editable and never auto-sent.
- **Macros**: saved reply templates with merge variables, keyed by situation (send pricing, book a call, redirect to a colleague, not the right person). Usable from a keyboard shortcut.
- **Context inputs** to the suggestion engine: the original campaign email, the lead's company/role, the lead's history, and a workspace-level "how we sell" context block the operator maintains.
- Suggestions must be **grounded**: if the reply contains a question the context doesn't answer, the suggestion says so rather than inventing a fact.

**Data.** `macros` (name, body, shortcut), `suggestions` (message_id, draft, model, accepted), `workspace_context`.

**Edge cases.** Never auto-send. Never fabricate pricing, timelines, or commitments — the suggestion should include a `[VERIFY]` marker where the operator must fill in a fact. An empty suggestion set is a valid state; show "no suggestion" rather than a generic template.

**Acceptance.** Open an interested reply → get a draft mentioning the campaign topic; editing and sending it produces a correctly threaded message.

---

### 3.22 Webhooks & API

**Goal.** Let the rest of the stack react to what happens in Mailrung.

**Behavior**
- **Webhooks**: workspace-level endpoints, each with a URL, a signing secret, a subscribed event list, and a status (active/paused). Events: `campaign.created`, `campaign.launched`, `campaign.paused`, `campaign.completed`, `email.sent`, `email.bounced`, `email.opened`, `link.clicked`, `reply.received`, `lead.status_changed`, `opportunity.created`, `opportunity.won`, `lead.created`, `lead.invalid`, `mailbox.unhealthy`.
- **Delivery**: signed with `X-Mailrung-Signature` (HMAC-SHA256 over timestamp + body), with timestamp to prevent replay. Retries with exponential backoff (3 attempts), a visible delivery log, and a manual "resend" button.
- **REST API**: read + write for campaigns, leads, mailboxes, analytics, and actions (launch/pause/resume). API keys per workspace, revocable, scoped read/write. OpenAPI spec published.
- **Import from other tools**: the API accepts a lead payload directly, so existing scripts can push contacts in.

**Data.** `webhooks`, `webhook_deliveries` (payload, status, attempts, response), `api_keys` (hashed).

**Edge cases.** A webhook endpoint that 500s must not block the campaign — delivery is fully async and out-of-band. Delivery order is not guaranteed; include a monotonic event id so consumers can dedupe. Retries must not deliver the same event id as a new event.

**Acceptance.** Register a webhook for `reply.received`; a reply triggers a signed POST with the expected payload; a failing endpoint retries and is visible in the delivery log.

---

### 3.23 Campaign templates

**Goal.** Don't rebuild the same sequence for every client.

**Behavior**
- Save any campaign's step list (or a single step) as a **template** with a name and description.
- Applying a template copies its steps into the target campaign as a **draft** — it never overwrites existing steps without confirmation.
- Templates capture step structure (subject, body, delay, variants, thread mode) but **not** the lead list, mailboxes, or limits — those are always set fresh per campaign.
- Templates are workspace-scoped, duplicable, and deletable. System templates ship with reasonable defaults (a 3-step cold sequence, a re-engagement sequence).

**Data.** `sequence_templates`, `template_steps`.

**Edge cases.** Applying to a live campaign must not disturb in-flight lead state — appended steps are new steps; existing leads keep their current step.

**Acceptance.** Save a working campaign as a template, create a new campaign, apply it → identical step structure, empty lead list, ready to configure.

---

### 3.24 Global preferences

**Goal.** Set the defaults once; stop re-configuring every campaign.

**Behavior**
- **Workspace**: timezone (default for daily boundaries and report display), default daily campaign limit, default per-mailbox cap and min-gap, default send window, tracking defaults (open/link tracking on/off), text-only default.
- **AI toggles**: enable/disable reply classification, auto-apply vs. suggest-only, which statuses the classifier may use, confidence threshold, model choice, and the API key.
- **Verification**: provider API key, daily verification cap, whether to verify on import by default.
- **Inbox**: whether to sync non-lead mail, which folders to include, default reply behavior.
- **Users**: a simple user list (email, name, role `admin|member`). Roles gate a small set of actions (see §5). No per-seat billing, no invitations flow, no SSO — a user is added by an admin by email.

**Data.** `workspaces`, `workspace_settings` (JSONB), `users`, `user_roles`, `verification_provider_keys` (encrypted).

**Edge cases.** Changing the workspace timezone must not retroactively shift historical daily-boundary aggregations — recompute boundaries from the campaign's schedule at send time and store daily buckets in UTC. API keys are stored encrypted at rest and never returned in full after creation.

**Acceptance.** Changing the default per-mailbox cap affects new campaigns and is visibly applied to existing ones on their next edit/save.

---

## 4. Architecture

**Four deployable services + infrastructure, all in one Docker Compose stack on a single VPS.**

```
                     ┌──────────────────────────┐
  Browser  ────────▶ │  caddy (edge)            │
                     │  React SPA (Vite, TS)    │
                     │  static + /api proxy     │
                     └────────────┬─────────────┘
                                  │ REST + WebSocket
                     ┌────────────▼─────────────┐
                     │  api (Node/TS)           │
                     │  Fastify + Drizzle ORM   │
                     │  Auth, CRUD, analytics   │
                     └────┬──────────────┬──────┘
                          │              │ enqueue
              ┌───────────▼──────┐   ┌───▼──────────────┐
              │  worker (Node/TS)│   │  dispatcher (Go) │
              │  BullMQ workers  │   │  batch sender    │
              │  scheduler,      │   │  pacing,         │
              │  reply match,    │   │  rotation,       │
              │  AI classify,    │   │  quota           │
              │  webhooks        │   └───┬──────────────┘
              └───────────┬──────┘       │ SMTP/IMAP
                          │              ▼
              ┌───────────▼──────┐   ┌──────────────┐
              │  Postgres        │   │  EmailEngine  │
              │  source of truth │   │  (OAuth,      │
              └──────────────────┘   │   IMAP, SMTP) │
                                     └──────────────┘
```

### 4.1 Service responsibilities

**`web` — React + TypeScript (Vite).** SPA. Screens: Dashboard, Campaigns, Campaign detail (Sequence / Leads / Settings / Analytics tabs), Mailboxes, Leads, Lists, Unibox, Analytics, Settings. Talks to `api` over REST; subscribes to a WebSocket for live activity and inbox updates. The build output is served by Caddy, the edge proxy, with the API proxied at `/api` and the WS at `/ws`.

**`api` — Node + TypeScript (Fastify + Drizzle ORM).** Owns auth (session cookie, argon2), all CRUD, campaign configuration, lead management, analytics queries, and the outbound REST API. Never sends email directly and never runs a long job inline.

**`worker` — Node + TypeScript (BullMQ on Redis).** The brain. Responsibilities:
- **Scheduler tick** (every 30s): for each active campaign, compute the set of leads due for their next step; write `send_jobs` rows.
- **Dispatcher poll** (every 2s): hand due jobs to the Go service.
- **Reply intake**: consume EmailEngine's `email_received` webhook; parse, attribute, and store the message; trigger classification and status updates.
- **Reply reconciliation** (every 5min): backstop poller for any reply the webhook missed.
- **Lead import processing**: parse and chunk CSVs.
- **Verification**: call the provider, update lead states, apply suppression.
- **AI classification**: classify replies, apply statuses, record feedback.
- **Webhooks**: deliver events with retries.
- **Analytics aggregation**: roll up `activities` into daily stats.
- **Rule engine**: evaluate auto-pause rules every 5 minutes.

**`dispatcher` — Go.** Purpose-built for the hot path: pull thousands of due `send_jobs` with `SELECT … FOR UPDATE SKIP LOCKED`, group them by target mailbox, apply the per-mailbox quota / min-gap / jitter, and submit them to EmailEngine concurrently with a bounded connection pool. Go earns its place here: the batching math and rate-limiting loop run in a tight native binary with no GC pauses, and it can hold thousands of in-flight submissions on a small box. A single binary, one config file, health endpoint on `:8090`.

**`EmailEngine` (self-hosted, Docker).** Owns all mail-protocol work: OAuth2 flows + token refresh for Google/Microsoft, IMAP, SMTP, and a hosted auth form. We call its REST API to create accounts and send, and register a per-account `email_received` webhook pointing at our worker. We never implement IMAP or OAuth ourselves.

**`Postgres`** — single source of truth. `activities` is append-only and the only table that grows without bound; partition it monthly once it exceeds ~5M rows.

**`Redis`** — BullMQ queues + short-lived cache (lead enrichment, verification results, scheduler scratch). Safe to lose; Postgres is authoritative.

### 4.2 Send path (detailed)

```
1. worker.scheduler  ──every 30s──▶ compute due steps → INSERT send_jobs(scheduled_at)
2. dispatcher(Go)   ──every 2s───▶ SELECT … FOR UPDATE SKIP LOCKED, LIMIT batch
                                    group by mailbox → apply quota + min-gap + jitter
                                    → POST to EmailEngine (concurrent, bounded pool)
3. EmailEngine      ─────────────▶ SMTP send
4. dispatcher        ◀───────────── result: sent / soft-bounce / hard-bounce / error
      │
      ├─ sent      → UPDATE send_jobs(state=sent); record activity;
      │               advance lead: current_step → next, set next_step_at
      ├─ hard     → mark lead invalid; add to blocklist; record activity + bounce
      ├─ soft     → retry (5min / 30min / 2h); after 3 → mark risky
      └─ error    → retry with backoff; count toward mailbox error rate
5. worker.reply     ◀──webhook───── EmailEngine email_received
      → store message → attribute to lead/campaign → classify → update status
      → maybe trigger subsequence → fire webhook
```

### 4.3 Why the Go service is separate from the Node worker

The Node worker's job is decision-making (which lead, which step, which mailbox, should we stop) — bursty, I/O-bound, benefits from the huge npm ecosystem for AI and email parsing. The Go service's job is *submission* — a tight, high-frequency loop of rate limiting and concurrent I/O, where GC pauses and event-loop starvation directly cause deliverability damage (missed min-gap windows, quota overruns). Splitting them means a slow classification call can never delay a send, and the send path stays predictable under load. They share only Postgres and Redis.

### 4.4 Key decisions

| Decision | Choice | Why |
|---|---|---|
| Mail protocol layer | Self-hosted EmailEngine | Avoids re-implementing OAuth2 + IMAP + SMTP. It's the single biggest time sink. |
| Lead source | CSV / Sheets only | Building lead discovery is a multi-month project. Out of scope. |
| Send-path runtime | Go, separate binary | Batching and pacing need predictability; isolates the hot path from the busy brain. |
| App runtime | Node + TS (Fastify) | Fastify for throughput, Drizzle for typed SQL, shared TS types with the frontend. |
| ORM | Drizzle | Type-safe SQL, no runtime reflection, migrations are plain SQL files. |
| Queue | BullMQ on Redis | Mature, good visibility, delay support, and the scheduler can use delayed jobs. |
| Frontend | React + Vite + TS | Fast dev loop, small bundle, easy to add a rich email editor. |
| Email editor | TipTap (ProseMirror) | Headless, extensible, good HTML output control. |
| Verification | Provider interface (NeverBounce default) | Swappable; results cached to control cost. |
| LLM | Provider-agnostic (Anthropic / OpenAI) | Model choice is a config value, not a code decision. |
| Auth | Session cookie, argon2, seeded admin | Internal tool; no SSO, no invitations, no password reset email. |
| Deployment | Single VPS, Docker Compose | Cheapest and simplest for 2–3 users. |

---

## 5. Data model (core tables)

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Operators | `id`, `email`, `name`, `role`, `password_hash` |
| `workspaces` | Single tenant | `id`, `name`, `timezone`, `settings` (JSONB) |
| `mailboxes` | Sending accounts | `id`, `email`, `provider`, `emailengine_id`, `status`, `daily_cap`, `health_score`, `tags[]` |
| `mailbox_daily_stats` | Per-mailbox per-day | `mailbox_id`, `date`, `sent`, `bounced`, `opened`, `replied`, `errors` |
| `domains` | Sending domains | `id`, `name`, `spf_status`, `dkim_status`, `dmarc_status`, `last_checked_at` |
| `leads` | Contacts | `id`, `email` (unique), `first_name`, `last_name`, `company`, `title`, `phone`, `custom_variables` (JSONB), `status_id`, `email_status`, `verification_score`, `owner_id` |
| `lead_labels` | Status definitions | `id`, `name`, `description`, `interest`, `is_builtin`, `use_ai` |
| `lead_status_events` | Status history | `lead_id`, `status_id`, `source` (`user`\|`ai`), `campaign_id`, `created_at` |
| `lead_lists` | Named lists | `id`, `name` |
| `lead_list_members` | List membership | `list_id`, `lead_id` |
| `campaigns` | Campaign config | `id`, `name`, `status` (0 draft / 1 active / 2 paused / 3 completed), `settings` (JSONB), `schedule` (JSONB), `daily_limit`, `daily_max_leads`, `owner_id` |
| `campaign_steps` | Sequence steps | `id`, `campaign_id`, `position`, `subject`, `body_html`, `body_text`, `preheader`, `delay_minutes`, `thread_mode` |
| `step_variants` | A/Z variants | `id`, `step_id`, `subject`, `body_html`, `weight`, `pinned` |
| `campaign_leads` | Enrollment + per-lead state | `id`, `campaign_id`, `lead_id`, `current_step_id`, `state`, `next_step_at`, `last_sent_at`, `variant_assignments` (JSONB), `paused_until`, `stopped_reason` |
| `subsequences` | Conditional follow-ups | `id`, `campaign_id`, `name`, `daily_limit_mode` |
| `subsequence_conditions` | Triggers | `subsequence_id`, `type` (`status`\|`activity`\|`keyword`), `values` (JSONB) |
| `subsequence_steps` | Subsequence steps | `id`, `subsequence_id`, `position`, `subject`, `body_html`, `delay_minutes` |
| `subsequence_members` | Lead in a subsequence | `subsequence_id`, `campaign_lead_id`, `entered_at` |
| `send_jobs` | Outbox for the Go dispatcher | `id`, `campaign_lead_id`, `step_id`, `mailbox_id`, `scheduled_at`, `state`, `attempts`, `last_error` |
| `activities` | Append-only event log | `id`, `campaign_id`, `lead_id`, `mailbox_id`, `step_id`, `variant_id`, `type`, `link_url`, `meta` (JSONB), `created_at` |
| `bounces` | Bounce detail | `id`, `lead_id`, `campaign_id`, `mailbox_id`, `step_id`, `reason`, `code`, `created_at` |
| `blocklist` | Suppression | `id`, `type` (`email`\|`domain`), `value`, `source`, `created_at` |
| `conversations` | Unibox threads | `id`, `lead_id`, `campaign_id`, `mailbox_id`, `last_message_at`, `is_read` |
| `messages` | Inbound/outbound mail | `id`, `conversation_id`, `direction`, `from`, `to`, `subject`, `body`, `is_auto_reply`, `created_at` |
| `classifications` | AI results | `id`, `message_id`, `status_id`, `confidence`, `sentiment`, `summary`, `model`, `feedback` |
| `opportunities` | Pipeline | `id`, `lead_id`, `campaign_id`, `status`, `value_minor`, `currency`, `source`, `created_at`, `closed_at` |
| `macros` | Saved reply templates | `id`, `name`, `body`, `shortcut` |
| `reminders` | Inbox reminders | `id`, `conversation_id`, `due_at`, `done` |
| `scheduled_replies` | Deferred sends | `id`, `conversation_id`, `body`, `send_at`, `state` |
| `webhooks` | Endpoints | `id`, `url`, `secret`, `events[]`, `active` |
| `webhook_deliveries` | Delivery log | `id`, `webhook_id`, `event_id`, `payload`, `status`, `attempts`, `response` |
| `api_keys` | API auth | `id`, `name`, `hash`, `scopes`, `last_used_at` |
| `import_jobs` | Import tracking | `id`, `source`, `status`, `total_rows`, `processed`, `failed`, `mapping` (JSONB) |
| `verifications` | Cached results | `email`, `provider`, `result`, `score`, `checked_at`, `cached_until` |
| `campaign_health_events` | Auto-pause audit | `id`, `campaign_id`, `rule`, `metric_value`, `threshold`, `action`, `created_at` |
| `audit_log` | Who changed what | `id`, `user_id`, `entity`, `entity_id`, `action`, `before`, `after`, `created_at` |

---

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| **Send correctness** | Zero emails sent to a lead on the blocklist. Zero emails sent exceeding a mailbox's daily cap. A send job is never executed twice (idempotency on `send_jobs.id`). |
| **SMTP throughput** | ≥ 5,000 sends/day on a 4-vCPU / 8GB VPS, with ≤ 2 mailboxes. (Cold email practice caps per mailbox at 30–50/day, so the ceiling is a safety limit, not a target.) |
| **Latency** | Campaign dashboard, lead table, and analytics respond in < 500ms at 100k leads / 5M activities. Unibox opens < 300ms. |
| **Real-time** | A reply appears in Unibox within 10s of arrival. A send appears in the activity log within 5s. |
| **Reliability** | The worker survives a Postgres or EmailEngine blip without losing a scheduled send. Sends are at-least-once with the idempotency key preventing duplicates. |
| **Data safety** | Passwords and provider API keys argon2/bcrypt-hashed or encrypted at rest. Email bodies and lead PII never logged. Daily Postgres backups retained 14 days, off-VPS. |
| **Observability** | Structured logs (JSON) shipped to stdout, collected by `docker compose logs`. Health endpoints on `api` and `dispatcher`. A `/health` that verifies Postgres + Redis + EmailEngine reachability. |
| **Browser support** | Last 2 versions of Chrome, Firefox, Safari. Desktop-first (this is an operator tool). |
| **Accessibility** | Keyboard-navigable inbox, WCAG AA contrast on the dashboard. |
| **Uptime** | 99% target — it is an internal tool; a mid-day outage is an annoyance, not an outage. |

---

## 7. Milestones

**M1 — Foundation** (2 wks): VPS + Docker Compose; Postgres + Redis; EmailEngine deployed and a Gmail account connected via OAuth; auth; app shell; mailboxes CRUD + connection test + health score. **— done**

**M2 — Leads** (2 wks): CSV/Sheets import with column mapping, dedupe, custom variables; lead list CRUD; lead table with filters, sorting, bulk actions, CSV export; verification integration. **— done, except the verification provider wiring and the list bulk actions**

**M3 — Campaign engine** (3 wks): campaign + step + variant model; sequence builder with editor and merge variables; preview + test send; launch/pause/resume; Go dispatcher with rotation, quota, min-gap, jitter; send-job outbox; personalisation; send windows; stop conditions; bounce handling and blocklist. **— done**

**M4 — Inbox** (3 wks): EmailEngine webhook intake; Unibox thread view, folders, filters, search; inline reply, scheduled replies, reminders, macros; status pipeline; OOO detect + auto-resume; opportunities. **— done**

**M5 — Analytics & automation** (2 wks): campaign/step/variant/mailbox analytics; activity log + CSV export; auto-pause rules; subsequences; webhooks + public REST API. **— done**

**M6 — AI layer & polish** (2 wks): reply classification with feedback; reply suggestions; Spintax/Liquid hardening; DNS + blacklist checks; text-only mode; `List-Unsubscribe`; campaign templates. **— the classifier and the reply suggestions are built and wired to Ollama; the feedback loop and the rest are next**

**Total: ~14 weeks** for one full-time engineer, or ~7–8 weeks for two.

### Where each feature landed

| PRD section | Where it lives |
|---|---|
| §3.5 Personalization | `apps/dispatcher/internal/render` — `{{variables}}`, `{{ x \| default: "y" }}`, `{% if %}`, `{spintax}` |
| §3.7 Send scheduling | `apps/worker/src/components/scheduler/rules.ts` — `always` / `office_hours` / `custom`, per-rule timezone, overnight windows |
| §3.8 Sending rules | `apps/worker/src/components/scheduler/rules.ts` — `stop_on_reply`, `stop_on_auto_reply`, `stop_for_company`, `daily_max_leads` |
| §3.9 Rotation & pacing | `apps/dispatcher/internal/pacing` — per-mailbox cap, gap and jitter, driven by the campaign's own settings |
| §3.10 Bounce & suppression | `apps/worker/src/components/events/service.ts` — hard bounce → invalid lead, blocklist, stop everywhere |
| §3.12 Unified inbox | `apps/api/src/components/inbox` + `apps/web/src/pages/Inbox.tsx` — folders, inline reply, scheduled replies, reminders, macros, attach-lead |
| §3.13 AI reply classification | `apps/worker/src/components/classification` — the rules decide OOO and unsubscribe without a model call, and a model decides the rest. The model is Ollama's cloud; a decision model returns a real confidence score, a chat model does not. |
| §3.14 Lead status pipeline | `lead_status_events` + the nine seeded statuses |
| §3.15 Opportunities | `opportunities` table, created from a positive reply with a buying signal |
| §3.16 Out-of-office | `leads.ooo_until` — a pause, not a stop; the scheduler resumes the lead on the return date |
| §3.17 Subsequences | `apps/worker/src/components/subsequences` + `apps/api/src/components/subsequences` |
| §3.18 Analytics | `activities` → `campaign_daily_stats`, `apps/api/src/components/analytics` — the funnel, the activity log, per-mailbox metrics, the CSV export, the auto-pause rules and the diagnosis |
| §3.22 Webhooks & API | Outbound webhooks + `apps/api/src/components/public-api` (api-key auth) |
| §3.11 Auto-pause | `apps/worker/src/components/auto-pause` — evaluated on every scheduler tick; the pause and its reason are recorded |
| §3.18 Diagnose | `apps/api/src/components/analytics/service.ts` — one reason and one remedy, checked from the most fundamental down |
| §3.3 Lead lists | `apps/api/src/components/lists` + `apps/web/src/pages/Lists.tsx` — a list is a view over the workspace's leads, never a copy. Attaching one to a campaign enrolls everyone in it; a lead added afterwards is enrolled too, unless the campaign turned that off. |
| §3.4 Sequence builder | `apps/web/src/components/sequence/SequenceEditor.tsx` — add, edit, reorder and delete steps, A/Z variants, delays in days, preview and test send. The preview renders through the dispatcher, so it cannot disagree with the real message. |
| §3.21 Reply suggestions | `apps/api/src/components/inbox` — the model sees the whole thread and drafts a reply. A draft, not a send. |
| §3.11 Dashboard | `apps/web/src/pages/Dashboard.tsx` — live numbers from `/analytics/overview`, `/analytics/activity` and `/inbox/opportunities` |

---

## 8. Open questions

1. **Sending domains** — do we already own cold domains, and how many? This determines how many mailboxes can be warmed up in parallel and caps campaign volume.
2. **Verification provider** — NeverBounce is in the workspace; do we have a paid API key, or should the provider be swappable from day one?
3. **LLM access** — which provider and key for classification/suggestions? Should the key be per-workspace (so it's a config value, not a code change)?
4. **Client separation** — do campaigns need a per-client notion of "workspace" from day one, or is a single workspace with campaign tags enough for 2–3 operators?
5. **Existing assets** — the workspace has `gtm-engineer`, `check-if-email-exists`, and `openehsaan-emchecker`. Is there existing lead-generation code we should reuse instead of rebuilding import + verification?
6. **CRM sync** — out of scope for v1, but should there be a webhook shape designed for a future HubSpot/Salesforce push?

---

## 9. Appendix — what was deliberately cut, and why

| Cut | Reason |
|---|---|
| **Warmup / deliverability network** | Explicitly deferred. Also the hardest part to replicate — Instantly's is a 4.2M-account private network. Realistic substitute: gradual per-mailbox volume ramp (§3.7) + a manual ramp schedule. |
| **450M lead database / SuperSearch** | A multi-month build. CSV import covers the actual need. |
| **SISR (dedicated IP sharding)** | Premature at 2–3 users and a handful of mailboxes. |
| **Inbox placement testing** | Requires a seed-list panel of live inboxes to test against. A DNS/blacklist check (§3.20) captures most of the value at low cost. |
| **LinkedIn / multichannel** | Doubles the surface area; email is the stated need. |
| **AI sales agent / autonomous prospecting** | A separate product. |
| **Billing, plans, credits, seats** | Internal tool with a known user count. Adds a payment provider, metering, and entitlement complexity for zero benefit. |
| **Public API + webhooks** | *Not cut* — kept, because the surrounding stack (GTM tooling already in the workspace) will need to push leads in and pull results out. |
| **SSO / invitations** | 2–3 known users. Admin adds a user by email. |
