/**
 * A minimal EmailEngine client for the worker.
 *
 * The worker needs exactly two things from EmailEngine: send a message, and
 * know which account to send it from. The api has a fuller client, but the
 * two run in different processes and share nothing but the wire format.
 *
 * `account` is EmailEngine's account id — the same string we store in
 * `mailboxes.emailengine_id` — not our own mailbox id.
 */

export interface EmailEngineConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export interface SubmitResult {
  messageId: string;
  queueId?: string;
}

export function createEmailEngineClient(config: EmailEngineConfig) {
  const base = config.baseUrl.replace(/\/$/, "");

  async function post<T>(path: string, payload: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          `EmailEngine ${path} returned ${res.status}: ${text.slice(0, 300)}`,
        );
      }

      return (text ? JSON.parse(text) : null) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * Sends a message.
     *
     * `to` is an array of address objects, not a string — EmailEngine
     * rejects the string form.
     */
    async submit(
      account: string,
      input: {
        to: string;
        subject: string;
        html?: string;
        text?: string;
        /**
         * The id of the message being replied to: EmailEngine's own id
         * for a message it delivered, or an RFC Message-ID for one we
         * sent.
         */
        inReplyTo?: string;
      },
    ): Promise<SubmitResult> {
      const payload: Record<string, unknown> = {
        to: [{ address: input.to }],
        subject: input.subject,
      };
      if (input.html) payload.html = input.html;
      if (input.text) payload.text = input.text;

      // EmailEngine's submit payload has no `inReplyTo` field — sending
      // one fails the whole request with 400 "Invalid input". A reply is
      // threaded through `reference` instead: EmailEngine fills in the
      // In-Reply-To and References headers from the message it names.
      const parentId = input.inReplyTo?.trim();
      if (parentId) {
        if (parentId.startsWith("<")) {
          payload.headers = { "In-Reply-To": parentId, References: parentId };
        } else {
          payload.reference = {
            message: parentId,
            action: "reply",
            // A parent EmailEngine can no longer find must not stop the
            // reply from going out; it goes out unthreaded instead.
            ignoreMissing: true,
          };
        }
      }

      const result = await post<SubmitResult>(
        `/v1/account/${encodeURIComponent(account)}/submit`,
        payload,
      );

      return { messageId: result?.messageId ?? "", queueId: result?.queueId };
    },
  };
}

export type EmailEngineClient = ReturnType<typeof createEmailEngineClient>;
