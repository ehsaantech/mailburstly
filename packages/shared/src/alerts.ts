/**
 * Alerting.
 *
 * The rules live here so the api, the worker and the dispatcher behave the
 * same way when something breaks:
 *
 *  - an alert is identified by a key (`dispatcher.submit_failed`);
 *  - the same key is not mailed twice inside the cooldown window, so a
 *    campaign that fails five hundred times produces one email, not five
 *    hundred;
 *  - the next email after the cooldown says how many times it happened in
 *    the meantime, so "one send failed" never hides "every send failed";
 *  - a hard cap per hour keeps a storm from becoming a mail flood;
 *  - nothing here throws. A broken alert path must never break the code
 *    that raised it, and a failed alert is never itself alerted about.
 *
 * The recipients are resolved by the caller, because the list lives in the
 * database and this package must not depend on one.
 */

export type AlertSeverity = "error" | "warning";

/** One address that should hear about alerts. */
export interface AlertRecipient {
  email: string;
  name?: string | null;
  /**
   * The lowest severity this address wants. "warning" receives everything,
   * "error" receives only errors.
   */
  severity: AlertSeverity;
}

export interface AlertContext {
  [key: string]: unknown;
}

export interface AlertInput {
  /** Stable identifier for this kind of failure. Deduplication is per key. */
  key: string;
  title: string;
  message: string;
  severity?: AlertSeverity;
  /** Structured detail, rendered as a table. */
  context?: AlertContext;
  /** Which service raised it. Shown in the email. */
  service?: string;
}

/** A rendered alert, ready for a transport to deliver. */
export interface AlertMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** How an alert reaches an inbox. Resend is one implementation of this. */
export interface AlertTransport {
  send(message: AlertMessage): Promise<void>;
}

export interface AlerterOptions {
  /** Null disables alerting entirely. */
  transport: AlertTransport | null;
  /** The addresses that should receive this alert. */
  resolveRecipients: () => Promise<AlertRecipient[]>;
  /** How long the same key stays quiet. Default: 5 minutes. */
  cooldownMs?: number;
  /** Hard cap on emails per hour, across all keys. Default: 20. */
  maxAlertsPerHour?: number;
  /** Injectable clock, so the tests do not have to sleep. */
  now?: () => number;
  /** Called when the alert path itself fails. Never re-alerts. */
  onError?: (error: unknown, detail: { key: string }) => void;
  /** Called after an alert was delivered. */
  onSent?: (detail: { key: string; to: string[]; repeats: number }) => void;
  /** Name of the sending service, shown in the email. */
  service?: string;
}

export interface Alerter {
  readonly enabled: boolean;
  /** Raises an alert. Resolves even when the alert could not be delivered. */
  alert(input: AlertInput): Promise<void>;
  /**
   * Sends to specific addresses, ignoring the cooldown and the severity
   * filter. This is the "send a test to this address" path.
   */
  alertNow(input: AlertInput & { to: string[] }): Promise<boolean>;
}

const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_MAX_PER_HOUR = 20;
const HOUR_MS = 60 * 60_000;

interface KeyState {
  /** When the last delivery attempt for this key was made. */
  lastAttemptAt: number;
  /** How many times this key was suppressed since the last email. */
  suppressed: number;
}

/**
 * True when the recipient wants to hear about this severity.
 *
 * A recipient on "error" is only told about errors; one on "warning" is
 * told about everything.
 */
export function wantsSeverity(
  recipient: AlertRecipient,
  severity: AlertSeverity,
): boolean {
  return severity === "error" || recipient.severity === "warning";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Renders an alert into the subject, html and text a transport sends. */
export function renderAlert(
  to: string[],
  input: AlertInput,
  repeats: number,
  service: string,
  at: Date = new Date(),
): AlertMessage {
  const severity = input.severity ?? "error";
  const label = severity === "error" ? "ERROR" : "WARNING";
  const subject = `[${service}] ${label} — ${input.title}`;
  const context = input.context ?? {};
  const entries = Object.entries(context);

  const rows = entries.map(([key, value]) => {
    const text = formatValue(value);
    return `<tr>
      <td style="padding:4px 12px 4px 0;color:#6b7280;font-size:12px;white-space:nowrap;vertical-align:top;">${escapeHtml(key)}</td>
      <td style="padding:4px 0;color:#111827;font-size:13px;word-break:break-word;">${escapeHtml(text)}</td>
    </tr>`;
  });

  const repeatNote =
    repeats > 0
      ? `<p style="margin:0 0 12px;color:#b45309;font-size:13px;">This happened <strong>${repeats}</strong> more time${repeats === 1 ? "" : "s"} since the last alert. The repeats were collapsed into this one email.</p>`
      : "";

  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;color:#111827;max-width:640px;">
  <div style="display:inline-block;padding:2px 8px;border-radius:4px;background:${severity === "error" ? "#fee2e2" : "#fef3c7"};color:${severity === "error" ? "#991b1b" : "#92400e"};font-size:11px;font-weight:600;letter-spacing:0.04em;">${label}</div>
  <h1 style="margin:10px 0 6px;font-size:18px;font-weight:600;">${escapeHtml(input.title)}</h1>
  <p style="margin:0 0 12px;color:#374151;">${escapeHtml(input.message)}</p>
  ${repeatNote}
  ${
    entries.length > 0
      ? `<table style="border-collapse:collapse;margin:0 0 14px;">${rows.join("")}</table>`
      : ""
  }
  <p style="margin:0;color:#6b7280;font-size:12px;">Service: ${escapeHtml(service)} · Key: ${escapeHtml(input.key)} · Time: ${escapeHtml(at.toISOString())}</p>
</div>`;

  const textLines = [
    `${label}: ${input.title}`,
    "",
    input.message,
  ];
  if (repeats > 0) {
    textLines.push(
      "",
      `This happened ${repeats} more time${repeats === 1 ? "" : "s"} since the last alert.`,
    );
  }
  if (entries.length > 0) {
    textLines.push("", "Details:");
    for (const [key, value] of entries) {
      textLines.push(`  ${key}: ${formatValue(value)}`);
    }
  }
  textLines.push(
    "",
    `Service: ${service} · Key: ${input.key} · Time: ${at.toISOString()}`,
  );

  return { to, subject, html, text: textLines.join("\n") };
}

export function createAlerter(options: AlerterOptions): Alerter {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const maxAlertsPerHour = options.maxAlertsPerHour ?? DEFAULT_MAX_PER_HOUR;
  const now = options.now ?? (() => Date.now());
  const states = new Map<string, KeyState>();
  /** Timestamps of delivered alerts, for the hourly cap. */
  const delivered: number[] = [];

  const enabled = Boolean(options.transport);

  function report(error: unknown, key: string): void {
    try {
      options.onError?.(error, { key });
    } catch {
      // The error handler is the last line of defence. If it throws, there is
      // nothing left to do but swallow it.
    }
  }

  function overCap(at: number): boolean {
    while (delivered.length > 0 && at - delivered[0]! >= HOUR_MS) {
      delivered.shift();
    }
    return delivered.length >= maxAlertsPerHour;
  }

  /**
   * Gives a reservation back.
   *
   * Used when the alert could not be attempted for a reason that has
   * nothing to do with the failure itself — no recipients, a broken lookup
   * — so the next occurrence is not swallowed by the quiet window.
   */
  function release(key: string, previous: KeyState | undefined): void {
    if (previous) {
      states.set(key, previous);
    } else {
      states.delete(key);
    }
  }

  async function deliver(
    to: string[],
    input: AlertInput,
    repeats: number,
  ): Promise<void> {
    const transport = options.transport;
    if (!transport) return;
    const message = renderAlert(
      to,
      input,
      repeats,
      input.service ?? options.service ?? "mailrung",
    );
    await transport.send(message);
  }

  return {
    enabled,

    async alert(input: AlertInput): Promise<void> {
      if (!options.transport) return;

      const at = now();
      const severity = input.severity ?? "error";
      const state = states.get(input.key);

      // Quiet window. The occurrence is counted, not mailed.
      if (state && at - state.lastAttemptAt < cooldownMs) {
        state.suppressed += 1;
        return;
      }

      // Reserve the key *before* the send. Two failures arriving in the same
      // moment must produce one email between them, not two — and the
      // reservation has to happen synchronously, before the first await, or
      // both calls would see an empty state and both would send.
      const repeats = state?.suppressed ?? 0;
      states.set(input.key, { lastAttemptAt: at, suppressed: 0 });

      if (overCap(at)) {
        release(input.key, state);
        report(
          new Error(
            `alert flood guard: ${maxAlertsPerHour} alerts already sent this hour`,
          ),
          input.key,
        );
        return;
      }

      let recipients: AlertRecipient[];
      try {
        recipients = await options.resolveRecipients();
      } catch (error) {
        report(error, input.key);
        release(input.key, state);
        return;
      }

      const to = recipients
        .filter((recipient) => wantsSeverity(recipient, severity))
        .map((recipient) => recipient.email)
        .filter((email) => email.length > 0);

      if (to.length === 0) {
        // Nobody wants this severity. That is not an error worth an alert —
        // and the reservation is given back, so an alert is still delivered
        // the moment a matching recipient is added.
        release(input.key, state);
        report(
          new Error("no enabled alert recipient wants this severity"),
          input.key,
        );
        return;
      }

      try {
        await deliver(to, input, repeats);
        delivered.push(at);
        try {
          options.onSent?.({ key: input.key, to, repeats });
        } catch {
          // A logging failure is not worth breaking the alert over.
        }
      } catch (error) {
        report(error, input.key);
        // The attempt is still recorded, so a broken transport is not
        // hammered on every occurrence — but the repeats are kept, so the
        // next alert can still say how many there were.
        states.set(input.key, { lastAttemptAt: at, suppressed: repeats });
      }
    },

    async alertNow(input: AlertInput & { to: string[] }): Promise<boolean> {
      if (!options.transport) return false;

      const at = now();
      try {
        await deliver(input.to, input, 0);
        delivered.push(at);
        return true;
      } catch (error) {
        report(error, input.key);
        return false;
      }
    },
  };
}
