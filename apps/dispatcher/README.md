# dispatcher

Go send hot path. Polls `send_jobs` with `FOR UPDATE SKIP LOCKED`, groups by
mailbox, applies per-mailbox pacing (daily quota, min-gap, random jitter), and
submits to the mail gateway concurrently.

## Why a separate binary

The api and worker are Bun processes — bursty, I/O-bound, great at AI calls
and email parsing. The dispatcher is a tight rate-limiting loop where a GC
pause means a missed min-gap window or a quota overshoot, both of which damage
sender reputation. Keeping it separate means a slow classification call can
never delay a send.

They share only Postgres.

## Running

```bash
go run ./cmd/dispatcher
```

Requires `DATABASE_URL` and `MAILCORE_API_TOKEN`.

## Health

```
GET /healthz  → 200 { "status": "ok", "checks": { "database": "ok" } }
GET /readyz   → same
```