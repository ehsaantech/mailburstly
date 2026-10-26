# api

Bun + Hono HTTP service. Everything is TypeScript — there is no build step, `bun src/index.ts` runs the source directly and `bun --watch` hot-reloads it.

## Layering

Every domain lives in `src/components/<name>/` with the same three files. Dependencies flow one way only:

```
db (@mailrung/db schema) ─▶ repository ─▶ service ─▶ controller ─▶ route
```

| File | Owns | Never does |
|---|---:|---|
| **controller.ts** | HTTP: routes, parsing, cookies, status codes | Queries the database, holds business rules |
| **service.ts** | Business logic, validation of *meaning*, orchestration | Builds SQL or reads `c.req` |
| **repository.ts** | The db layer: queries and row shapes | Knows about HTTP |
| **validator.ts** | Zod schemas + TS types shared by controller and service | Talks to anything |

Two rules make the layering hold:

1. **Nothing in `controller.ts` may import from `drizzle-orm`**, and nothing in `repository.ts` may import from `hono`. If a change seems to require it, the business logic belongs in the service — that is why the service exists.
2. **Dependencies are allocated only in `src/routes.ts`.** Every other file receives its dependencies by argument, so the worker can reuse a repository without also inheriting the api's env, and tests can inject a transaction.

```
src/
├── index.ts                 # entry: Bun.serve, shutdown handling
├── app.ts                   # Hono app: middleware order, onError, notFound
├── routes.ts                # composition root — the ONLY place dependencies are wired
├── env.ts                   # validated environment, frozen
├── types.ts                 # Hono `Env` typing (requestId, user, session)
├── db/
│   ├── client.ts            # postgres-js pool + drizzle — see architecture.md §6
│   └── index.ts             # singleton handle, ping/close for /health
├── core/                    # cross-cutting, no domain knowledge
│   ├── errors.ts            # AppError + 4xx/5xx factories + Postgres error mapping
│   ├── response.ts          # ok / created / noContent / paginated
│   ├── validate.ts          # parseJson / parseQuery / parseParams
│   ├── password.ts          # argon2id via Bun.password
│   └── logger.ts            # structured JSON logger (no pino)
├── middleware/
│   ├── request-id.ts        # x-request-id, echoed on the response
│   ├── logger.ts            # one line per request: method, path, status, duration
│   └── auth.ts              # requireAuth, requireRole, SESSION_COOKIE
└── components/
    ├── health/              # has no service or repository — it is a probe
    ├── auth/
    │   ├── controller.ts    # /login /logout /me
    │   ├── service.ts       # credential check, session mint/revoke
    │   ├── repository.ts    # users + sessions queries
    │   └── validator.ts     # loginSchema
    ├── mailboxes/
    │   ├── controller.ts    # CRUD
    │   ├── service.ts       # workspace scoping, not-found enforcement
    │   ├── repository.ts    # mailbox queries + row→API mapping
    │   └── validator.ts     # create/update schemas, 50-cap enforced here
    └── workspace/           # single-tenant: reads the one row
        ├── controller.ts    # /current
        └── repository.ts

```

## Conventions

**Routes are mounted in `routes.ts`, which is also where "not built yet" is visible.** Unbuilt domains are registered with `app.all("/campaigns/*")` throwing `notImplemented`, so a client gets a structured 501 naming the resource instead of a silent 404. When a component is built, delete its entry from the `pending` array and add the real `app.route(...)` line.

**Success and error envelopes are fixed.** Success is `{ data: ... }`, errors are `{ error: { code, message, details? }, requestId }`. A consumer never decides how to read a body by inspecting the status code.

**Errors that are not `AppError` are bugs.** They get a 500 with the message and stack in the logs, never in the body. The request id is always present so a bad response can be traced to its log line.

**Validation is explicit, not middleware.** Call `parseJson(c, Schema)` at the top of a handler. It produces a 400 with per-field details (`{ "email": ["..."] }`) using the same envelope, rather than Hono's zod-validator error shape, which is why no validator package is used.

## Adding a component

Create four files, wire one line in `routes.ts`, and read the `mailboxes` component alongside — it demonstrates every convention including the `notFound` path and the repository-to-API mapping.

```ts
// controller.ts
export function createWidgetRoutes(widgets: WidgetService) {
  const routes = new Hono<AppContext>();
  routes.use("*", requireAuth);        // every domain route is authed
  routes.get("/", async (c) => ok(c, { items: await widgets.list() }));
  return routes;
}
```

## Running

```bash
bun --watch src/index.ts       # dev, from apps/api
bun run dev                    # from the repo root: web + api together
```

You will need the schema and seed first:

```bash
bun run db:generate && bun run db:migrate && bun run db:seed
```

`bun run dev` works with no `.env` — the defaults point at `localhost:5432` with the seed password. In production the api refuses to boot while `SESSION_SECRET` is still the development placeholder.