/**
 * mailcore — the mail gateway.
 *
 * It owns everything protocol-shaped: OAuth2 consent, IMAP/SMTP transport,
 * the Gmail API and Microsoft Graph, the open/click tracking, and the events
 * the worker consumes. Business decisions stay in the api and the worker.
 *
 * It speaks the subset of EmailEngine's REST contract that the rest of the
 * app already uses, so the cutover is a change of base URL.
 */
import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";

import { env } from "./env";
import { migrate, sql } from "./db";
import {
  deleteAccount,
  dueEvents,
  enqueueEvent,
  getAccount,
  getCursor,
  listAccounts,
  markDelivered,
  markFailed,
  recordMessage,
  saveOAuthState,
  setAccountStatus,
  setCursor,
  takeOAuthState,
  updateTokens,
  upsertAccount,
} from "./store";
import {
  authorizeUrl,
  exchangeCode,
  fetchIdentity,
  googleProvider,
  microsoftProvider,
  newState,
  newVerifier,
  refreshAccessToken,
  type OAuthProvider,
} from "./oauth";
import {
  imapSync,
  imapVerify,
  smtpSend,
  smtpVerify,
  type Account,
  type Provider,
} from "./providers";
import { gmailSend, gmailSync, graphSend, graphSync } from "./api-providers";
import { backoffMs, deliver, envelope } from "./webhook";
import { forwardToLegacy, legacyAccounts } from "./legacy";

const app = new Hono();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function requireAuth(c: { req: { header(name: string): string | undefined } }) {
  if (!env.MAILCORE_API_TOKEN) return;
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== env.MAILCORE_API_TOKEN) {
    throw new HttpError(401, "Unauthorized", "invalid or missing token");
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly label: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof HttpError) {
    return c.json(
      { statusCode: e.status, error: e.label, message: e.message },
      e.status as 400,
    );
  }
  const message = e instanceof Error ? e.message : String(e);
  return c.json(
    { statusCode: 500, error: "Internal Server Error", message },
    500,
  );
}

function accountJson(a: Account) {
  return {
    account: a.id,
    email: a.email,
    name: a.displayName,
    type: a.provider === "microsoft" ? "outlook" : a.provider === "google" ? "gmail" : "imap",
    state: a.status,
    createdAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

app.get("/health", (c) => c.json({ ok: true }));

/* -------------------------------------------------------------------------- */
/* OAuth                                                                       */
/* -------------------------------------------------------------------------- */

function providerFor(id: string): OAuthProvider {
  const redirectUri = `${env.MAILCORE_PUBLIC_URL}/oauth/callback`;
  if (id === "microsoft") {
    return microsoftProvider(
      env.MICROSOFT_CLIENT_ID,
      env.MICROSOFT_CLIENT_SECRET,
      redirectUri,
      env.MICROSOFT_TENANT,
    );
  }
  return googleProvider(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );
}

app.get("/oauth/start", async (c) => {
  const provider = c.req.query("provider") ?? "google";
  const accountId = c.req.query("account") ?? randomUUID();
  const displayName = c.req.query("name") ?? null;

  const p = providerFor(provider);
  if (!p.clientId) {
    return c.json(
      { statusCode: 503, error: "Service Unavailable", message: `${provider} client id not configured` },
      503,
    );
  }

  const state = newState();
  const verifier = newVerifier();
  await saveOAuthState({
    state,
    accountId,
    provider,
    codeVerifier: verifier,
    redirectTo: `${env.MAILCORE_PUBLIC_URL}/mailboxes/callback`,
    displayName,
  });

  return c.redirect(authorizeUrl(p, state, verifier));
});

app.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.json({ error: "missing code or state" }, 400);
  }
  const row = await takeOAuthState(state);
  if (!row) {
    return c.json({ error: "invalid or expired state" }, 400);
  }

  const p = providerFor(row.provider);
  const tokens = await exchangeCode(p, code, row.codeVerifier);
  const email = await fetchIdentity(p, tokens.accessToken);

  await upsertAccount({
    id: row.accountId,
    email,
    displayName: row.displayName ?? email,
    provider: row.provider as Provider,
    status: "connected",
    scopes: p.scopes,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  });

  return c.redirect(`${row.redirectTo}?account=${row.accountId}&state=new`);
});

/* -------------------------------------------------------------------------- */
/* Compat API — the surface the api, worker and dispatcher already call        */
/* -------------------------------------------------------------------------- */

app.use("/v1/*", async (c, next) => {
  requireAuth(c);
  await next();
});

app.post("/v1/authentication/form", async (c) => {
  const body = (await c.req.json()) as {
    account?: string;
    provider?: string;
    name?: string;
    type?: string;
  };
  const provider = body.provider ?? "google";
  const account = body.account ?? randomUUID();
  const url = `${env.MAILCORE_PUBLIC_URL}/oauth/start?provider=${provider}&account=${account}${
    body.name ? `&name=${encodeURIComponent(body.name)}` : ""
  }`;
  return c.json({ url });
});

app.get("/v1/accounts", async (c) => {
  const accounts = await listAccounts();
  const legacy = await legacyAccounts();
  return c.json({
    accounts: [
      ...accounts.map((a) => ({ ...accountJson(a), source: "mailcore" })),
      ...legacy,
    ],
  });
});

app.get("/v1/account/:id", async (c) => {
  const id = c.req.param("id");
  const account = await getAccount(id);
  if (!account) {
    const legacy = await forwardToLegacy(`/v1/account/${encodeURIComponent(id)}`, "GET", undefined);
    if (legacy) return new Response(legacy.body, { status: legacy.status, headers: { "Content-Type": "application/json" } });
    return c.json({ statusCode: 404, error: "Not Found" }, 404);
  }
  return c.json(accountJson(account));
});

app.post("/v1/account", async (c) => {
  const body = (await c.req.json()) as {
    account?: string;
    email?: string;
    name?: string;
    imap?: Record<string, unknown>;
    smtp?: Record<string, unknown>;
  };
  const id = body.account ?? randomUUID();
  const settings = { imap: body.imap ?? {}, smtp: body.smtp ?? {} };
  await upsertAccount({
    id,
    email: body.email ?? "",
    displayName: body.name ?? body.email ?? null,
    provider: "imap",
    status: "connected",
    scopes: [],
    accessToken: "",
    refreshToken: "manual",
    expiresAt: 0,
    settings,
  });
  return c.json({ account: id, state: "connected" });
});

app.delete("/v1/account/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await getAccount(id))) {
    const legacy = await forwardToLegacy(`/v1/account/${encodeURIComponent(id)}`, "DELETE", undefined);
    if (legacy) return new Response(null, { status: legacy.status });
  }
  await deleteAccount(id);
  return c.body(null, 204);
});

app.put("/v1/account/:id/reconnect", async (c) => {
  const id = c.req.param("id");
  const account = await getAccount(id);
  const provider = account?.provider ?? "google";
  return c.json({
    url: `${env.MAILCORE_PUBLIC_URL}/oauth/start?provider=${provider}&account=${id}`,
  });
});

app.post("/v1/verifyaccount", async (c) => {
  const body = (await c.req.json()) as {
    imap?: Record<string, unknown>;
    smtp?: Record<string, unknown>;
  };
  const imap = body.imap ? await imapVerify(body.imap) : false;
  const smtp = body.smtp ? await smtpVerify(body.smtp) : false;
  return c.json({ imap, smtp });
});

app.post("/v1/settings", async (c) => {
  const body = await c.req.json();
  await sql`INSERT INTO mail_settings (key, value) VALUES ('settings', ${JSON.stringify(body)}::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(body)}::jsonb`;
  return c.json({ ok: true });
});

app.post("/v1/oauth2", async (c) =>
  c.json({
    app: "mailcore",
    message:
      "Configure GOOGLE_CLIENT_ID / MICROSOFT_CLIENT_ID in mailcore's environment instead.",
  }),
);

/* -------------------------------------------------------------------------- */
/* Send                                                                        */
/* -------------------------------------------------------------------------- */

app.post("/v1/account/:id/submit", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as {
      to?: { address: string }[];
      subject?: string;
      text?: string;
      html?: string;
      headers?: Record<string, string>;
      reference?: { message?: string; action?: string; ignoreMissing?: boolean };
      trackOpens?: boolean;
      trackClicks?: boolean;
    };

    let account = await getAccount(id);
    if (!account) {
      // The account may still be held by the legacy engine, which owns its
      // tokens. Forward the send there instead of failing.
      const legacy = await forwardToLegacy(
        `/v1/account/${encodeURIComponent(id)}/submit`,
        "POST",
        body,
      );
      if (legacy) {
        return new Response(legacy.body, {
          status: legacy.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return c.json({ statusCode: 404, error: "Not Found" }, 404);
    }

    const to = body.to?.[0]?.address ?? "";
    const subject = body.subject ?? "";
    const text = body.text ?? "";
    const html = body.html ?? "";
    const messageId = `<${randomUUID()}@mailcore>`;

    // Threading: a parent id we know becomes the In-Reply-To/References
    // headers. An unknown one is dropped, not fatal.
    let references: string[] = [];
    let threadId: string | null = null;
    if (body.reference?.message) {
      const parent = body.reference.message;
      const rows = await sql<{ rfc_message_id: string | null; thread_id: string | null }[]>`
        SELECT rfc_message_id, thread_id FROM mail_messages
         WHERE id = ${parent} OR (account_id = ${id} AND rfc_message_id = ${parent})
         LIMIT 1
      `;
      if (rows[0]?.rfc_message_id) references = [rows[0].rfc_message_id];
      threadId = rows[0]?.thread_id ?? null;
    }

    let result: { messageId: string; providerId: string | null; threadId: string | null };

    const sendInput = {
      from: account.email,
      fromName: account.displayName,
      to,
      subject,
      text,
      html,
      messageId,
      headers: body.headers,
      references,
      threadId,
    };

    if (account.provider === "imap") {
      // Plain SMTP: nodemailer builds and delivers the message.
      result = await smtpSend(account.settings, sendInput);
    } else if (account.provider === "google") {
      result = await gmailSend(account, sendInput);
    } else {
      result = await graphSend(account, sendInput);
    }

    await recordMessage(
      randomUUID(),
      account.id,
      result.providerId ?? result.messageId,
      result.messageId,
      result.threadId,
      "SENT",
      "outbound",
      Date.now(),
      subject,
      account.email,
      to,
    );

    return c.json({ messageId: result.messageId, queueId: result.providerId });
  } catch (e) {
    return fail(c, e);
  }
});

/* -------------------------------------------------------------------------- */
/* Tracking                                                                    */
/* -------------------------------------------------------------------------- */

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

app.get("/t/o/:token.gif", async (c) => {
  const token = c.req.param("token");
  await enqueueEvent(null, "trackOpen", {
    messageId: token,
    originalMessageId: token,
    userAgent: c.req.header("user-agent") ?? null,
    date: new Date().toISOString(),
  });
  c.header("Content-Type", "image/gif");
  c.header("Cache-Control", "no-store");
  return c.body(PIXEL);
});

app.get("/t/c/:id", async (c) => {
  const id = c.req.param("id");
  await enqueueEvent(null, "trackClick", {
    messageId: id,
    originalMessageId: id,
    url: c.req.query("url") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
    date: new Date().toISOString(),
  });
  return c.redirect("/");
});

app.get("/u/:token", (c) =>
  c.html("<p>Unsubscribe confirmed. You will not receive further mail.</p>"),
);

app.post("/u/:token", async (c) => {
  const token = c.req.param("token");
  await enqueueEvent(null, "listUnsubscribe", { recipient: token });
  return c.body(null, 200);
});

/* -------------------------------------------------------------------------- */
/* Sync loop                                                                   */
/* -------------------------------------------------------------------------- */

async function syncOnce(): Promise<void> {
  const accounts = await listAccounts();

  for (const account of accounts) {
    if (account.provider === "imap" && account.status !== "connected") continue;

    try {
      // Refresh the access token when it is about to expire.
      let accessToken = account.accessToken;
      if (
        account.provider !== "imap" &&
        account.refreshToken &&
        account.accessExpiresAt &&
        account.accessExpiresAt - Date.now() < 5 * 60 * 1000
      ) {
        const p = providerFor(account.provider);
        const tokens = await refreshAccessToken(p, account.refreshToken);
        accessToken = tokens.accessToken;
        await updateTokens(
          account.id,
          tokens.accessToken,
          tokens.refreshToken || account.refreshToken,
          Date.now() + tokens.expiresIn * 1000,
        );
      }

      const cursor = await getCursor(account.id);
      let messages;
      let nextCursor: string;

      if (account.provider === "imap") {
        const result = await imapSync(account.settings, cursor);
        messages = result.messages;
        nextCursor = result.cursor;
      } else if (account.provider === "google") {
        const result = await gmailSync({ ...account, accessToken }, cursor);
        messages = result.messages;
        nextCursor = result.cursor;
      } else {
        const result = await graphSync({ ...account, accessToken }, cursor);
        messages = result.messages;
        nextCursor = result.cursor;
      }

      for (const m of messages) {
        const isNew = await recordMessage(
          randomUUID(),
          account.id,
          m.providerId,
          m.rfcMessageId,
          m.threadId,
          m.folder,
          m.direction,
          m.internalDate,
          m.subject,
          m.from,
          m.to,
        );
        if (!isNew) continue;

        if (m.isBounce) {
          await enqueueEvent(account.id, "messageBounce", {
            recipient: m.from,
            messageId: m.rfcMessageId,
            response: { status: "5.1.1", message: m.subject ?? "bounced" },
          });
          continue;
        }
        if (m.isComplaint) {
          await enqueueEvent(account.id, "messageComplaint", {
            recipient: m.from,
          });
          continue;
        }

        await enqueueEvent(account.id, "messageNew", {
          // The id must be unique across every mailbox: IMAP UIDs and Graph
          // message ids are only unique within one mailbox, and the worker
          // dedupes on this value globally.
          id: `${account.id}:${m.providerId}`,
          emailId: m.providerId,
          threadId: m.threadId,
          date: new Date(m.internalDate).toISOString(),
          subject: m.subject,
          from: { address: m.from, name: m.fromName ?? undefined },
          to: [{ address: m.to }],
          messageId: m.rfcMessageId,
          inReplyTo: m.inReplyTo,
          text: { plain: m.plain, html: m.html },
          isAutoReply: m.isAutoReply,
          isBounce: m.isBounce,
          isComplaint: m.isComplaint,
        });
      }

      if (nextCursor && nextCursor !== cursor) {
        await setCursor(account.id, nextCursor);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("sync failed", account.email, message);
      if (account.provider !== "imap") {
        await setAccountStatus(account.id, "authentication_error", message);
      }
    }
  }
}

async function deliverLoop(): Promise<void> {
  const events = await dueEvents();
  for (const e of events) {
    const body = envelope(e.accountId, e.event, JSON.parse(e.payload));
    const result = await deliver(
      env.MAILCORE_WEBHOOK_URL,
      env.MAILCORE_WEBHOOK_SECRET,
      e.id,
      body,
    );
    if (result.ok) {
      await markDelivered(e.id);
    } else {
      await markFailed(
        e.id,
        result.error ?? "delivery failed",
        new Date(Date.now() + backoffMs(e.attempts)),
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  await migrate();

  const server = Bun.serve({
    port: env.MAILCORE_PORT,
    fetch: app.fetch,
  });
  console.log(`mailcore listening on :${env.MAILCORE_PORT}`);

  const syncTimer = setInterval(() => {
    syncOnce().catch((e) => console.error("sync loop failed", e));
  }, env.MAILCORE_SYNC_INTERVAL * 1000);
  const deliverTimer = setInterval(() => {
    deliverLoop().catch((e) => console.error("delivery loop failed", e));
  }, 5000);

  const shutdown = async () => {
    clearInterval(syncTimer);
    clearInterval(deliverTimer);
    await server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // One pass immediately so a restart does not wait a whole interval.
  await syncOnce().catch((e) => console.error("initial sync failed", e));
}

main().catch((error) => {
  console.error("mailcore failed to start:", error);
  process.exit(1);
});
