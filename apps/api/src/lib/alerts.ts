/**
 * Alerting for the api.
 *
 * The alerter itself lives in @mailrung/shared so the api, the worker and
 * the dispatcher all behave the same way. What lives here is the wiring:
 * the Resend transport, the recipient lookup, and a module-level handle so
 * a module that cannot be handed a dependency (the mailcore client, for
 * one) can still raise an alert.
 *
 * Nothing in here may throw into the caller. A broken alert path must never
 * be the reason a request fails.
 */

import { and, eq } from "drizzle-orm";
import {
  createAlerter,
  createResendTransport,
  type Alerter,
  type AlertInput,
  type AlertRecipient,
} from "@mailrung/shared";
import { alertRecipients } from "@mailrung/db";

import { env } from "@/env";
import type { DbHandle } from "@/db";
import type { Logger } from "@/core/logger";

/**
 * How long the recipient list is cached.
 *
 * Alerts are rare and already deduplicated, so a lookup per alert would be
 * fine — but a storm of them would hammer Postgres for an answer that
 * changes once a day.
 */
const RECIPIENT_CACHE_MS = 60_000;

export interface AlertingDeps {
  db: DbHandle;
  log: Logger;
  /** The workspace whose recipients should be told. */
  workspaceId: () => Promise<string>;
}

let alerter: Alerter | null = null;
let cached: { at: number; recipients: AlertRecipient[] } | null = null;

/** Creates the alerter and installs it as the process-wide handle. */
export function initAlerter(deps: AlertingDeps): Alerter {
  const transport =
    env.RESEND_API_KEY && env.ALERT_ENABLED
      ? createResendTransport({
          apiKey: env.RESEND_API_KEY,
          from: env.ALERT_FROM_EMAIL,
        })
      : null;

  async function resolveRecipients(): Promise<AlertRecipient[]> {
    const now = Date.now();
    if (cached && now - cached.at < RECIPIENT_CACHE_MS) {
      return cached.recipients;
    }

    const workspaceId = await deps.workspaceId();
    const rows = await deps.db.db
      .select({
        email: alertRecipients.email,
        name: alertRecipients.name,
        severity: alertRecipients.severity,
      })
      .from(alertRecipients)
      .where(
        and(
          eq(alertRecipients.workspaceId, workspaceId),
          eq(alertRecipients.enabled, true),
        ),
      );

    const recipients: AlertRecipient[] = rows.map((row) => ({
      email: row.email,
      name: row.name,
      severity: row.severity,
    }));

    cached = { at: now, recipients };
    return recipients;
  }

  alerter = createAlerter({
    transport,
    resolveRecipients,
    cooldownMs: env.ALERT_COOLDOWN_MS,
    maxAlertsPerHour: env.ALERT_MAX_PER_HOUR,
    service: "api",
    onError: (error, detail) => {
      deps.log.error("alert could not be delivered", {
        key: detail.key,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onSent: (detail) => {
      deps.log.info("alert sent", {
        key: detail.key,
        to: detail.to.join(","),
        repeats: detail.repeats,
      });
    },
  });

  deps.log.info("alerting ready", {
    enabled: alerter.enabled,
    from: env.ALERT_FROM_EMAIL,
  });

  return alerter;
}

/** The process-wide alerter, or null before it is initialised. */
export function getAlerter(): Alerter | null {
  return alerter;
}

/** Forgets the cached recipient list, so a change takes effect at once. */
export function invalidateRecipients(): void {
  cached = null;
}

/**
 * Raises an alert.
 *
 * Awaiting this is safe: it resolves even when the alert could not be
 * delivered. Callers that are on a hot path should not await it.
 */
export async function raiseAlert(input: AlertInput): Promise<void> {
  if (!alerter) return;
  try {
    await alerter.alert(input);
  } catch (error) {
    // The alerter does not throw, but a bug in here must still not take the
    // request down with it.
    console.error("alert failed", error);
  }
}
