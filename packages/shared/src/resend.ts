/**
 * Resend transport.
 *
 * The alerting core knows nothing about Resend — it hands over a rendered
 * message, and this delivers it. Using Resend is deliberate: it is a
 * completely separate provider from the mail gateway we send campaigns
 * through, so an alert still goes out when the gateway is the thing that
 * broke.
 *
 * The official SDK is used rather than a hand-rolled fetch: it keeps the
 * request shape honest when the api changes, and it gives us typed errors
 * and an abort signal for the timeout.
 */

import { Resend } from "resend";

import type { AlertMessage, AlertTransport } from "./alerts";

export interface ResendTransportOptions {
  /** The Resend api key. */
  apiKey: string;
  /** The verified sender, e.g. "alerts@mail.ehsaanlabs.com". */
  from: string;
  /** How long to wait before abandoning the request. Default: 10 seconds. */
  timeoutMs?: number;
}

export function createResendTransport(
  options: ResendTransportOptions,
): AlertTransport {
  const resend = new Resend(options.apiKey);
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async send(message: AlertMessage): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const { data, error } = await resend.emails.send(
          {
            from: options.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          },
          { signal: controller.signal },
        );

        if (error) {
          throw new Error(`Resend refused the alert: ${error.message}`);
        }
        if (!data?.id) {
          throw new Error("Resend accepted the alert but returned no id");
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
