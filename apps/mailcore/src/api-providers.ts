/**
 * Gmail API and Microsoft Graph adapters.
 *
 * Both are plain REST calls — no SDK needed, and no SDK to keep in step with
 * the providers. What they share with the IMAP/SMTP path is the message
 * shape they return, so the sync loop does not care which one produced a
 * message.
 */
import {
  buildMime,
  type Account,
  type InboundMessage,
  type SendInput,
  type SendResult,
  type SyncResult,
} from "./providers";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const GRAPH = "https://graph.microsoft.com/v1.0";

async function gmailHeaders(token: string): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/* -------------------------------------------------------------------------- */
/* Gmail                                                                       */
/* -------------------------------------------------------------------------- */

export async function gmailSend(
  account: Account,
  input: SendInput,
): Promise<SendResult> {
  const raw = await buildMime({
    from: account.email,
    fromName: account.displayName,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: input.messageId,
    headers: input.headers,
  });

  const payload: Record<string, unknown> = {
    raw: Buffer.from(raw).toString("base64url"),
  };
  if (input.threadId) payload.threadId = input.threadId;

  const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    headers: await gmailHeaders(account.accessToken),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`gmail send ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const sent = (await res.json()) as { id?: string; threadId?: string };

  // Gmail rewrites a custom Message-ID, so the real one is read back.
  const messageId = await gmailRealMessageId(account.accessToken, sent.id);
  return {
    messageId: messageId ?? input.messageId,
    providerId: sent.id ?? null,
    threadId: sent.threadId ?? input.threadId ?? null,
  };
}

async function gmailRealMessageId(
  token: string,
  id: string | undefined,
): Promise<string | null> {
  if (!id) return null;
  const res = await fetch(
    `${GMAIL_API}/users/me/messages/${id}?format=metadata&metadataHeaders=Message-ID`,
    { headers: await gmailHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    payload?: { headers?: { name?: string; value?: string }[] };
  };
  for (const h of body.payload?.headers ?? []) {
    if (h.name?.toLowerCase() === "message-id") return h.value ?? null;
  }
  return null;
}

export async function gmailSync(
  account: Account,
  cursor: string,
): Promise<SyncResult> {
  const list = await fetch(
    `${GMAIL_API}/users/me/messages?maxResults=25&q=${encodeURIComponent("in:inbox newer_than:2d")}`,
    { headers: await gmailHeaders(account.accessToken) },
  );
  if (!list.ok) {
    throw new Error(`gmail list ${list.status}: ${(await list.text()).slice(0, 200)}`);
  }
  const body = (await list.json()) as {
    messages?: { id: string; threadId?: string }[];
  };

  const messages: InboundMessage[] = [];
  for (const m of body.messages ?? []) {
    const res = await fetch(
      `${GMAIL_API}/users/me/messages/${m.id}?format=raw`,
      { headers: await gmailHeaders(account.accessToken) },
    );
    if (!res.ok) continue;
    const raw = Buffer.from(await res.arrayBuffer());
    const parsed = await parseSimple(raw);
    if (!parsed) continue;
    messages.push({
      providerId: m.id,
      rfcMessageId: parsed.messageId ?? null,
      threadId: m.threadId ?? null,
      folder: "INBOX",
      direction: "inbound",
      internalDate: parsed.date?.getTime() ?? Date.now(),
      subject: parsed.subject ?? null,
      from: addressText(parsed.from),
      to: addressText(parsed.to),
      plain: parsed.text ?? null,
      html: typeof parsed.html === "string" ? parsed.html : null,
      inReplyTo: parsed.inReplyTo ?? null,
      isAutoReply: isAutoReplyHeaders(parsed),
      isBounce: isBounceHeaders(parsed),
      isComplaint: false,
    });
  }

  return { messages, cursor: body.messages?.[0]?.id ?? cursor };
}

/* -------------------------------------------------------------------------- */
/* Microsoft Graph                                                             */
/* -------------------------------------------------------------------------- */

export async function graphSend(
  account: Account,
  input: SendInput,
): Promise<SendResult> {
  const raw = await buildMime({
    from: account.email,
    fromName: account.displayName,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: input.messageId,
    headers: input.headers,
  });

  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "text/plain",
    },
    body: Buffer.from(raw).toString("base64"),
  });
  if (!res.ok) {
    throw new Error(`graph send ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return {
    messageId: input.messageId,
    providerId: null,
    threadId: input.threadId ?? null,
  };
}

export async function graphSync(
  account: Account,
  cursor: string,
): Promise<SyncResult> {
  const url = cursor
    ? cursor
    : `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=subject,from,toRecipients,receivedDateTime,internetMessageId,conversationId,body`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`graph delta ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    value?: {
      id: string;
      subject?: string;
      receivedDateTime?: string;
      internetMessageId?: string;
      conversationId?: string;
      from?: { emailAddress?: { address?: string } };
      toRecipients?: { emailAddress?: { address?: string } }[];
      body?: { content?: string; contentType?: string };
    }[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
  };

  const messages: InboundMessage[] = [];
  for (const m of body.value ?? []) {
    messages.push({
      providerId: m.id,
      rfcMessageId: m.internetMessageId ?? null,
      threadId: m.conversationId ?? null,
      folder: "INBOX",
      direction: "inbound",
      internalDate: m.receivedDateTime
        ? new Date(m.receivedDateTime).getTime()
        : Date.now(),
      subject: m.subject ?? null,
      from: m.from?.emailAddress?.address ?? null,
      to:
        m.toRecipients?.map((r) => r.emailAddress?.address).filter(Boolean).join(", ") ??
        null,
      plain: null,
      html: m.body?.content ?? null,
      inReplyTo: null,
      isAutoReply: false,
      isBounce: false,
      isComplaint: false,
    });
  }

  const next = body["@odata.deltaLink"] ?? body["@odata.nextLink"] ?? cursor;
  return { messages, cursor: next };
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

/** An address field can be one address or a list of them. */
function addressText(
  value: { text?: string } | { text?: string }[] | undefined,
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const joined = value
      .map((v) => v.text)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .join(", ");
    return joined.length > 0 ? joined : null;
  }
  return typeof value.text === "string" ? value.text : null;
}

/** A header can be a string, a list, or a structured value. */
function headerValue(
  headers: { get(name: string): unknown },
  name: string,
): string | undefined {
  const raw = headers.get(name);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(", ");
  if (raw instanceof Date) return raw.toUTCString();
  return String(raw);
}

async function parseSimple(raw: Buffer) {
  const { simpleParser } = await import("mailparser");
  try {
    return await simpleParser(raw);
  } catch {
    return null;
  }
}

function isAutoReplyHeaders(parsed: {
  headers: { get(name: string): unknown };
}): boolean {
  const autoSubmitted = headerValue(parsed.headers, "auto-submitted");
  return (
    (autoSubmitted !== undefined && autoSubmitted.toLowerCase() !== "no") ||
    headerValue(parsed.headers, "x-autoreply") !== undefined ||
    headerValue(parsed.headers, "x-autorespond") !== undefined
  );
}

function isBounceHeaders(parsed: {
  headers: { get(name: string): unknown };
  subject?: string | null;
}): boolean {
  const contentType = headerValue(parsed.headers, "content-type") ?? "";
  return (
    contentType.toLowerCase().includes("multipart/report") &&
    (parsed.subject ?? "").toLowerCase().includes("undelivered")
  );
}
