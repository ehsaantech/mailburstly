/**
 * Provider adapters.
 *
 * Each adapter owns one way of talking to a mailbox and speaks the same small
 * interface, so the rest of mailcore does not care whether a message came
 * from the Gmail API, Microsoft Graph, or an IMAP server.
 *
 * The libraries here are the same MIT ones mailcore is built on:
 * `imapflow` (IMAP), `nodemailer` (SMTP), `mailparser` (MIME). Nothing here
 * re-implements a mail protocol.
 */
import { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";

export type Provider = "google" | "microsoft" | "imap";

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  provider: Provider;
  status: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  settings: Record<string, unknown>;
}

export interface ServerSettings {
  host: string;
  port: number;
  secure: "ssl" | "starttls" | "none";
  user: string;
  pass: string;
}

export interface InboundMessage {
  /** Provider-native id (Gmail id, Graph id, IMAP uid). */
  providerId: string;
  rfcMessageId: string | null;
  threadId: string | null;
  folder: string;
  direction: "inbound" | "outbound";
  internalDate: number;
  subject: string | null;
  from: string | null;
  fromName: string | null;
  to: string | null;
  plain: string | null;
  html: string | null;
  inReplyTo: string | null;
  isAutoReply: boolean;
  isBounce: boolean;
  isComplaint: boolean;
}

export interface SendInput {
  /** The sending address. */
  from: string;
  /** The display name shown to the recipient. */
  fromName?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** RFC Message-ID to send with. */
  messageId: string;
  headers?: Record<string, string>;
  /** RFC Message-IDs of the thread this message continues. */
  references?: string[];
  /** Provider-native thread to reply into, when there is one. */
  threadId?: string | null;
}

export interface SendResult {
  messageId: string;
  providerId: string | null;
  threadId: string | null;
}

export interface SyncResult {
  messages: InboundMessage[];
  /** Opaque cursor for the next pass. */
  cursor: string;
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Build a raw MIME message. Used by the API-based providers. */
export async function buildMime(input: {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  headers?: Record<string, string>;
  references?: string[];
}): Promise<Buffer> {
  const composer = new MailComposer({
    from: input.fromName
      ? { name: input.fromName, address: input.from }
      : input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: {
      "Message-ID": input.messageId,
      ...(input.references?.length
        ? {
            References: input.references.join(" "),
            "In-Reply-To": input.references[input.references.length - 1] ?? "",
          }
        : {}),
      ...(input.headers ?? {}),
    },
  });

  return await composer.compile().build();
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

/** Normalise a parsed message into the shape the rest of mailcore uses. */
function fromParsed(
  parsed: ParsedMail,
  meta: {
    providerId: string;
    folder: string;
    threadId?: string | null;
    direction?: "inbound" | "outbound";
  },
): InboundMessage {
  const autoSubmitted = headerValue(parsed.headers, "auto-submitted");
  const precedence = headerValue(parsed.headers, "precedence") ?? "";
  const contentType = headerValue(parsed.headers, "content-type") ?? "";

  const isAutoReply =
    (autoSubmitted !== undefined && autoSubmitted.toLowerCase() !== "no") ||
    precedence.toLowerCase().includes("auto_reply") ||
    headerValue(parsed.headers, "x-autoreply") !== undefined ||
    headerValue(parsed.headers, "x-autorespond") !== undefined;

  const isBounce =
    contentType.toLowerCase().includes("multipart/report") &&
    (parsed.subject ?? "").toLowerCase().includes("undelivered");

  const isComplaint =
    contentType.toLowerCase().includes("multipart/report") &&
    contentType.toLowerCase().includes("feedback-report");

  return {
    providerId: meta.providerId,
    rfcMessageId: parsed.messageId ?? null,
    threadId: meta.threadId ?? null,
    folder: meta.folder,
    direction: meta.direction ?? "inbound",
    internalDate: parsed.date?.getTime() ?? Date.now(),
    subject: parsed.subject ?? null,
    from: addressText(parsed.from),
    fromName: addressName(parsed.from),
    to: addressText(parsed.to),
    plain: parsed.text ?? null,
    html: typeof parsed.html === "string" ? parsed.html : null,
    inReplyTo: parsed.inReplyTo ?? null,
    isAutoReply,
    isBounce,
    isComplaint,
  };
}

/**
 * The bare email address of a parsed address field.
 *
 * mailparser's `text` is the *raw header value* — `"Yousuf Ayub"
 * <yousuf@ehsaantech.com>` — which is not an address. The worker compares
 * that string against mailbox addresses and lead emails, so a display name in
 * it breaks attribution and own-address detection. The address itself lives
 * in `value[].address`.
 */
function addressText(
  value: ParsedAddress | ParsedAddress[] | undefined,
): string | null {
  if (!value) return null;
  const list = Array.isArray(value) ? value : [value];
  for (const entry of list) {
    for (const v of entry.value ?? []) {
      if (v.address) return v.address.toLowerCase();
    }
  }
  return null;
}

/** The display name of a parsed address field, when it has one. */
function addressName(
  value: ParsedAddress | ParsedAddress[] | undefined,
): string | null {
  if (!value) return null;
  const list = Array.isArray(value) ? value : [value];
  for (const entry of list) {
    for (const v of entry.value ?? []) {
      if (v.address && v.name) return v.name;
    }
  }
  return null;
}

interface ParsedAddress {
  text?: string;
  value?: { address?: string; name?: string }[];
}

/* -------------------------------------------------------------------------- */
/* IMAP (imapflow — the engine behind mailcore)                           */
/* -------------------------------------------------------------------------- */

export function parseServerSettings(
  settings: Record<string, unknown>,
  key: "imap" | "smtp",
): ServerSettings {
  const block =
    (settings[key] as Record<string, unknown> | undefined) ?? settings;
  const rawSecure = block.secure;
  const port = Number(block.port ?? (key === "imap" ? 993 : 587));
  let secure: ServerSettings["secure"] = "none";
  if (typeof rawSecure === "string" && rawSecure !== "") secure = rawSecure as ServerSettings["secure"];
  else if (rawSecure === true) secure = port === 465 || port === 993 ? "ssl" : "starttls";

  return {
    host: String(block.host ?? ""),
    port,
    secure,
    user: String(block.user ?? ""),
    pass: String(block.pass ?? ""),
  };
}

export async function imapSync(
  settings: Record<string, unknown>,
  cursor: string,
): Promise<SyncResult> {
  const s = parseServerSettings(settings, "imap");
  if (!s.host) throw new Error("imap host missing");

  const client = new ImapFlow({
    host: s.host,
    port: s.port,
    secure: s.secure === "ssl",
    auth: { user: s.user, pass: s.pass },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    const messages: InboundMessage[] = [];
    let highest = Number(cursor ?? "0") || 0;

    try {
      // Fetch everything newer than the cursor. A UID range is a search
      // query, not a sequence set: `{ uid: "1:*" }` is the whole mailbox.
      const range = highest > 0 ? `${highest + 1}:*` : "1:*";
      for await (const msg of client.fetch({ uid: range }, {
        uid: true,
        source: true,
        envelope: true,
      })) {
        const uid = msg.uid;
        if (!uid) continue;
        if (uid <= highest) continue;
        highest = Math.max(highest, uid);
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source as Buffer);
        messages.push(
          fromParsed(parsed, {
            providerId: String(uid),
            folder: "INBOX",
            threadId: null,
          }),
        );
      }
    } finally {
      await lock.release();
    }

    return { messages, cursor: String(highest) };
  } finally {
    await client.logout().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* SMTP (nodemailer)                                                          */
/* -------------------------------------------------------------------------- */

export async function smtpSend(
  settings: Record<string, unknown>,
  input: SendInput,
): Promise<SendResult> {
  const s = parseServerSettings(settings, "smtp");
  if (!s.host) throw new Error("smtp host missing");

  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure === "ssl",
    requireTLS: s.secure === "starttls",
    auth: { user: s.user, pass: s.pass },
  });

  const info = await transport.sendMail({
    from: input.fromName
      ? { name: input.fromName, address: input.from }
      : input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: input.messageId,
    headers: input.headers,
    references: input.references,
  });

  return {
    messageId: info.messageId ?? input.messageId,
    providerId: info.messageId ?? null,
    threadId: null,
  };
}

export async function smtpVerify(
  settings: Record<string, unknown>,
): Promise<boolean> {
  const s = parseServerSettings(settings, "smtp");
  if (!s.host) return false;
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure === "ssl",
    requireTLS: s.secure === "starttls",
    auth: { user: s.user, pass: s.pass },
  });
  try {
    await transport.verify();
    return true;
  } catch {
    return false;
  }
}

export async function imapVerify(
  settings: Record<string, unknown>,
): Promise<boolean> {
  const s = parseServerSettings(settings, "imap");
  if (!s.host) return false;
  const client = new ImapFlow({
    host: s.host,
    port: s.port,
    secure: s.secure === "ssl",
    auth: { user: s.user, pass: s.pass },
    logger: false,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.logout().catch(() => {});
  }
}
