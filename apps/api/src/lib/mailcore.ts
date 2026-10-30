/**
 * HTTP client for the self-hosted mailcore.
 *
 * mailcore owns all mail-protocol work (OAuth2, IMAP, SMTP, token
 * refresh) and exposes it over REST. We never speak IMAP or OAuth ourselves;
 * this client is the only place mailcore's URL and bearer token live.
 *
 * All methods throw an `AppError` (or a plain `Error` for transport failures)
 * so callers can rely on a single error shape.
 */

// No unused imports — errors are surfaced as plain Error instances.
import { env } from "@/env";
import { raiseAlert } from "@/lib/alerts";

const BASE = env.MAILCORE_API_URL.replace(/\/$/, "");

function authHeaders(): Record<string, string> {
  const token = env.MAILCORE_API_TOKEN;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    // The gateway is down. Nothing can be sent until it is back, so this is
    // worth an email rather than a log line nobody reads.
    void raiseAlert({
      key: "api.emailengine_unreachable",
      title: "The api cannot reach the mail gateway",
      message: `mailcore at ${BASE} did not answer: ${detail}`,
      severity: "error",
      service: "api",
      context: { method, path, error: detail },
    });

    throw new Error(`mailcore unreachable at ${BASE}: ${detail}`);
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const detail =
      failureDetail(payload) || `returned ${response.status}`;

    // A 5xx is the gateway breaking. A 4xx is usually our payload, which is
    // a bug to fix rather than an incident to page about.
    if (response.status >= 500) {
      void raiseAlert({
        key: "api.emailengine_error",
        title: "The mail gateway refused a request",
        message: `mailcore ${method} ${path} returned ${response.status}: ${detail}`,
        severity: "error",
        service: "api",
        context: { method, path, status: response.status, detail },
      });
    }

    throw new Error(`mailcore ${method} ${path} failed: ${detail}`);
  }

  return payload as T;
}

/**
 * The reason a request was refused, in a form worth reading.
 *
 * A rejected payload is answered with a generic message ("Invalid input")
 * and the actual complaint in `fields` — which field was refused, and how.
 * Both are wanted: the operator needs to know *what* to fix, not that
 * something was wrong.
 */
function failureDetail(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const body = payload as { message?: unknown; fields?: unknown };

  const parts: string[] = [];
  if (typeof body.message === "string" && body.message.trim()) {
    parts.push(body.message.trim());
  }
  if (Array.isArray(body.fields)) {
    for (const field of body.fields) {
      const detail = (field as { message?: unknown } | null)?.message;
      if (typeof detail === "string" && detail.trim()) parts.push(detail.trim());
    }
  }

  return parts.join(" — ");
}

/* -------------------------------------------------------------------------- */
/* Form generation                                                            */
/* -------------------------------------------------------------------------- */

export interface AuthFormParams {
  /** Our mailbox id, reused as mailcore's account id. */
  account: string;
  email?: string;
  expectedEmail?: string;
  name?: string;
  /**
   * Provider hint for mailcore ("google" | "microsoft" | "imap_smtp").
   * Preferred over `type`, which mailcore ignores for routing.
   */
  provider?: string;
  /** OAuth2 application ID from mailcore's Integrations > OAuth2 Apps. */
  type?: string;
  skipServerSettings?: boolean;
  redirectUrl: string;
}

export interface AuthFormResult {
  url: string;
}

export async function generateAuthForm(
  params: AuthFormParams,
): Promise<AuthFormResult> {
  return request<AuthFormResult>("POST", "/v1/authentication/form", params);
}

/* -------------------------------------------------------------------------- */
/* Account management                                                         */
/* -------------------------------------------------------------------------- */

export interface MailcoreAccount {
  account: string;
  email: string;
  name: string | null;
  type: "gmail" | "outlook" | "imap" | "microsoft" | string;
  state: "connected" | "connecting" | "syncing" | "ready" | "disconnected" | "authenticationError" | "unset" | string;
  authFailureDisabledAt?: string | null;
  imap?: { host: string; port: number; secure: boolean };
  smtp?: { host: string; port: number; secure: boolean };
  oauth2?: { provider: string; scopes?: string[] };
  createdAt?: string;
}

export async function getAccount(accountId: string): Promise<MailcoreAccount> {
  return request<MailcoreAccount>("GET", `/v1/account/${encodeURIComponent(accountId)}`);
}

export async function deleteAccount(accountId: string): Promise<void> {
  await request("DELETE", `/v1/account/${encodeURIComponent(accountId)}`);
}

export async function reconnectAccount(accountId: string): Promise<void> {
  await request("PUT", `/v1/account/${encodeURIComponent(accountId)}/reconnect`);
}

/**
 * Ask mailcore to verify an IMAP/SMTP pair up front. Only meaningful for
 * manual IMAP accounts; OAuth accounts verify during the consent flow.
 */
export async function verifyAccount(settings: {
  imap: { host: string; port: number; secure: boolean; user: string; pass: string };
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
}): Promise<{ imap: boolean; smtp: boolean }> {
  return request("POST", "/v1/verifyaccount", settings);
}

export async function createManualAccount(settings: {
  account: string;
  email: string;
  name?: string;
  imap: Record<string, unknown>;
  smtp: Record<string, unknown>;
}): Promise<{ account: string; state?: string }> {
  return request("POST", "/v1/account", settings);
}

/* -------------------------------------------------------------------------- */
/* Provider mapping                                                           */
/* -------------------------------------------------------------------------- */

export type MailboxProvider = "google" | "microsoft" | "imap_smtp";

/**
 * Map mailcore's account type to our provider enum. mailcore reports
 * "gmail" / "outlook" / "imap" / "microsoft"; anything else falls back to
 * imap_smtp so we never store an unknown value.
 */
export function providerFromAccountType(type: string): MailboxProvider {
  if (type === "gmail" || type === "google") return "google";
  if (type === "outlook" || type === "microsoft" || type === "office365") return "microsoft";
  return "imap_smtp";
}

/**
 * Map mailcore's connection state to our health score. A brand-new account
 * that is still syncing gets a generous 80; anything in an error state gets 0
 * so it is visibly unhealthy in the UI.
 */
export function healthFromState(state: string): number {
  switch (state) {
    case "connected":
    case "ready":
      return 95;
    case "syncing":
      return 80;
    case "connecting":
      return 50;
    case "disconnected":
      return 30;
    default:
      return 0;
  }
}

export function isHealthyState(state: string): boolean {
  return state === "connected" || state === "ready" || state === "syncing";
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

export interface SubmitMessageInput {
  /** The recipient address. */
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /**
   * The id of the message being replied to: mailcore's own id for a
   * message it delivered, or an RFC Message-ID for one we sent. Either
   * way the client turns it into the headers a threaded reply needs.
   */
  inReplyTo?: string;
  /**
   * Emit a one-click `List-Unsubscribe` header. mailcore mints a token that
   * identifies the recipient, so the link names the right lead when it is
   * followed.
   */
  unsubscribeHeader?: boolean;
}

export interface SubmitMessageResult {
  messageId: string;
  queueId?: string;
}

/**
 * The fields that thread a reply onto the message it answers.
 *
 * mailcore's submit payload has no `inReplyTo` field: sending one fails
 * the whole request with 400 "Invalid input", which is where every reply
 * to a thread used to die.
 *
 * Two id shapes reach us, because `messages.provider_message_id` holds
 * mailcore's own id for a message it delivered and the RFC Message-ID
 * for one we sent:
 *
 * - an mailcore id goes in `reference`, and mailcore fills in the
 *   In-Reply-To and References headers from the message it names, and
 *   flags that message as answered;
 * - an RFC Message-ID goes into the headers directly.
 */
function threadingPayload(
  parentId: string | undefined,
): { reference?: Record<string, unknown>; headers?: Record<string, string> } {
  const id = parentId?.trim();
  if (!id) return {};

  if (id.startsWith("<")) {
    return { headers: { "In-Reply-To": id, References: id } };
  }

  return {
    reference: {
      message: id,
      action: "reply",
      // A parent mailcore can no longer find — deleted, moved to the
      // trash — must not stop the reply from going out. It goes out
      // unthreaded instead.
      ignoreMissing: true,
    },
  };
}

/**
 * Sends a message through mailcore.
 *
 * `account` is mailcore's account id, not our mailbox id — the two
 * differ, and sending to the wrong one fails. `to` is an array of address
 * objects, not a string.
 */
export async function submitMessage(
  account: string,
  input: SubmitMessageInput,
): Promise<SubmitMessageResult> {
  const payload: Record<string, unknown> = {
    to: [{ address: input.to }],
    subject: input.subject,
  };
  if (input.html) payload.html = input.html;
  if (input.text) payload.text = input.text;

  const threading = threadingPayload(input.inReplyTo);
  if (threading.reference) payload.reference = threading.reference;
  if (threading.headers) payload.headers = threading.headers;
  if (input.unsubscribeHeader) payload.unsubscribeHeader = true;

  const result = await request<SubmitMessageResult>(
    "POST",
    `/v1/account/${encodeURIComponent(account)}/submit`,
    payload,
  );

  return {
    messageId: result?.messageId ?? "",
    queueId: result?.queueId,
  };
}
