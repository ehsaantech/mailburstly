# Project instructions

## Dummy emails

- Always send dummy/test emails to **haroon@yopmail.com**. That address is
  the only sanctioned sink for a test send.
- Never send a test email to a real lead, a real contact, or a made-up
  `example.com` address — a send that cannot be delivered proves nothing,
  and one that can reaches a stranger.
- A reply to a real lead is the operator's call, never the agent's: fix the
  path, prove it on `haroon@yopmail.com`, and leave the real send to them.
- Say in the summary which address a test went to.

## Alerts

- The alert recipients live in the database (`alert_recipients`), not in an
  environment variable. **haroon@ehsaantech.com** is the operator's own
  address and is on that list.
- That address is where *live* alerts go — the system telling the operator
  that something broke. It is not a test sink: the test sink is
  haroon@yopmail.com.
- `bun run verify:alerts` and `bun run verify:alert-recipients` send their
  test to haroon@yopmail.com unless `TEST_RECIPIENT` says otherwise.

## Verify

- `bun run typecheck` — types across every app and package.
- `bun run test:ts` — the bun test suite (`bun test apps/worker/src
  apps/api/src packages/shared/src`).
- `bun run test:go` — the dispatcher's Go tests.
- `docker compose up -d --build api worker` — the api and worker run in
  containers; a source change is not live until they are rebuilt.
