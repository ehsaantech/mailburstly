# worker

Bun + BullMQ job processor. Same layered convention as `apps/api`.

## Components

| Component | Trigger | Responsibility |
|---|---|---|
| `scheduler` | Repeatable job, every 30s | Compute due steps → INSERT `send_jobs` rows |
| `reply-intake` | EmailEngine `email_received` webhook | Attribute, store, classify, fan out |
| `classification` | Called by reply-intake | Regex pre-filter + LLM → apply status |
| `verification` | Called after lead import | Provider calls, cache, quarantine |
| `webhooks` | BullMQ delayed jobs | Outbound delivery with retries |
| `aggregation` | Repeatable job, every 5 min | Roll up `activities` → daily stats |

## Running

```bash
bun --watch src/index.ts       # dev
bun run dev                    # from repo root (web + api + worker)
```

Requires Postgres and Redis. The worker owns no campaign configuration — it
only processes the data the api leaves for it (`send_jobs`, etc.).

## Layering

Same rules as `apps/api`:

1. No `drizzle-orm` in controllers, no `hono` in repositories
2. Dependencies allocated only in `routes.ts`
3. Repository = SQL only, service = business logic, controller = HTTP surface

The worker has no request/response contract of its own, but the webhook
receiver still benefits from the same separation.