import { Hono } from "hono";

import { created, noContent, ok } from "@/core/response";
import { parseJson, parseParams } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { MailboxService } from "./service";
import {
  callbackMailboxSchema,
  connectMailboxSchema,
  createMailboxSchema,
  mailboxParamsSchema,
  updateMailboxSchema,
} from "./validator";

/**
 * Controller.
 *
 * `requireAuth` is injected rather than imported so dependencies are allocated
 * in one place (routes.ts), including the auth service it captures. Every
 * route is behind it: mailboxes gate the entire sending ability, so they are
 * never readable or writable without a session.
 *
 * The OAuth connect/callback pair is the exception: `connect` requires auth
 * (only a logged-in operator may add a mailbox), but `callback` does NOT, because
 * EmailEngine redirects the browser there after the user consents on Google's
 * side and the session cookie may not survive the cross-site hop. The callback
 * is therefore unauthed but only acts on an account id that EmailEngine itself
 * minted, which keeps it safe.
 */
export function createMailboxRoutes(
  mailboxes: MailboxService,
  requireAuth: AppMiddleware,
) {
  const routes = new Hono<AppBindings>();

  routes.get("/", requireAuth, async (c) =>
    ok(c, { items: await mailboxes.list() }),
  );

  routes.post("/", requireAuth, async (c) => {
    const input = await parseJson(c, createMailboxSchema);
    return created(c, { mailbox: await mailboxes.create(input) });
  });

  routes.get("/:id", requireAuth, async (c) => {
    const { id } = parseParams(c, mailboxParamsSchema);
    return ok(c, { mailbox: await mailboxes.get(id) });
  });

  routes.patch("/:id", requireAuth, async (c) => {
    const { id } = parseParams(c, mailboxParamsSchema);
    const patch = await parseJson(c, updateMailboxSchema);
    return ok(c, { mailbox: await mailboxes.update(id, patch) });
  });

  routes.delete("/:id", requireAuth, async (c) => {
    const { id } = parseParams(c, mailboxParamsSchema);
    await mailboxes.remove(id);
    return noContent(c);
  });

  /**
   * Start a hosted OAuth flow. Returns a single-use URL the frontend redirects
   * the browser to. The account does not exist yet — it is created in
   * `callback` once the user has consented.
   */
  routes.post("/connect", requireAuth, async (c) => {
    const input = await parseJson(c, connectMailboxSchema);
    const result = await mailboxes.connect(input);
    return ok(c, result);
  });

  /**
   * Finalise a hosted OAuth flow. EmailEngine redirects the browser here with
   * `?account=...&state=new|existing` after a successful consent. We fetch
   * the account from EmailEngine, create (or update) our mailbox row, and
   * compute an initial health score from the connection state.
   */
  routes.post("/callback", async (c) => {
    const input = await parseJson(c, callbackMailboxSchema);
    const mailbox = await mailboxes.callback(input);
    return ok(c, { mailbox });
  });

  return routes;
}