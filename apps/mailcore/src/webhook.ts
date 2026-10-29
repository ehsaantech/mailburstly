/**
 * Webhook delivery.
 *
 * The worker verifies an HMAC-SHA256 signature over the raw body and dedupes
 * on the event id, so delivery is at-least-once and the signature must be
 * computed over exactly the bytes that go on the wire.
 */
import { createHmac } from "node:crypto";

export function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** The envelope every event shares. */
export function envelope(
  account: string | null,
  event: string,
  data: unknown,
): string {
  return JSON.stringify({
    account,
    event,
    date: new Date().toISOString(),
    data,
  });
}

export interface DeliverResult {
  ok: boolean;
  status: number;
  error?: string;
}

export async function deliver(
  url: string,
  secret: string,
  eventId: string,
  body: string,
): Promise<DeliverResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "mailcore",
        "X-EE-Wh-Signature": sign(secret, body),
        "X-EE-Wh-Event-Id": eventId,
      },
      body,
    });
    if (res.ok) return { ok: true, status: res.status };
    return {
      ok: false,
      status: res.status,
      error: `webhook returned ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 5m, 30m, 2h, 6h, then every 6 hours. */
export function backoffMs(attempts: number): number {
  const schedule = [5, 30, 120, 360, 360, 360, 360, 360];
  const minutes = schedule[Math.min(attempts, schedule.length - 1)] ?? 360;
  return minutes * 60 * 1000;
}
