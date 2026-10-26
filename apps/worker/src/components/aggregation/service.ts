import type { Logger } from "@/core/logger";
import {
  createAggregationRepository,
  type AggregationRepository,
} from "./repository";

export interface AggregationServiceDeps {
  db: { db: Parameters<typeof createAggregationRepository>[0]["db"] };
  log: Logger;
  /** How many days back the rollup reaches. */
  windowDays?: number;
}

/**
 * How far back the rollup reaches.
 *
 * The rollup is a recomputation, so a wide window is safe — it just has to
 * be recomputed. A narrow window would leave the dashboard blank for every
 * day the worker was not running, which is exactly the history an operator
 * wants to see.
 */
const DEFAULT_WINDOW_DAYS = 90;

export function createAggregationService(deps: AggregationServiceDeps) {
  const repo: AggregationRepository = createAggregationRepository({
    db: deps.db.db,
  });
  const { log } = deps;
  const windowDays = deps.windowDays ?? DEFAULT_WINDOW_DAYS;

  /** "YYYY-MM-DD" for `offset` days before today. */
  function dateString(offset: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  }

  /** The counters one scope carries, before "delivered" is derived. */
  interface Raw {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    autoReplied: number;
    bounced: number;
    unsubscribed: number;
  }

  function add(into: Raw, from: Raw): Raw {
    return {
      sent: into.sent + from.sent,
      opened: into.opened + from.opened,
      clicked: into.clicked + from.clicked,
      replied: into.replied + from.replied,
      autoReplied: into.autoReplied + from.autoReplied,
      bounced: into.bounced + from.bounced,
      unsubscribed: into.unsubscribed + from.unsubscribed,
    };
  }

  /**
   * Delivered is what was not bounced.
   *
   * A hard bounce is the only delivery failure we can observe, so
   * sent-minus-bounced is the honest number rather than a second copy of
   * "sent".
   */
  function withDelivered(raw: Raw) {
    return { ...raw, delivered: Math.max(0, raw.sent - raw.bounced) };
  }

  return {
    /**
     * Rolls the activity log up into daily statistics.
     *
     * The rollup is a recomputation, not an increment: every run rewrites
     * the affected days from the raw activities. That makes it idempotent — a
     * run that crashes halfway leaves the next run to fix it, and a
     * duplicated event cannot inflate a counter.
     */
    async run(): Promise<void> {
      const to = dateString(0);
      const from = dateString(windowDays - 1);

      const campaigns = await repo.campaignsInWindow(from, to);
      if (campaigns.length === 0) {
        log.debug("nothing to aggregate");
        return;
      }

      let rows = 0;

      for (const { campaignId, workspaceId } of campaigns) {
        if (!campaignId) continue;

        const scopes = await repo.scopesFor(campaignId, from, to);
        if (scopes.length === 0) continue;

        // Three levels of scope, each a sum over the raw rows:
        //   the campaign total, the per-step total, the per-variant row.
        const byDate = new Map<string, Raw>();
        const byDateStep = new Map<string, Raw>();
        const byDateStepVariant = new Map<string, Raw>();

        for (const scope of scopes) {
          const raw: Raw = {
            sent: scope.sent,
            opened: scope.opened,
            clicked: scope.clicked,
            replied: scope.replied,
            autoReplied: scope.autoReplied,
            bounced: scope.bounced,
            unsubscribed: scope.unsubscribed,
          };

          const dateKey = scope.date;
          const stepKey = `${scope.date}|${scope.stepId ?? ""}`;
          const variantKey = `${scope.date}|${scope.stepId ?? ""}|${scope.variantId ?? ""}`;

          byDate.set(dateKey, add(byDate.get(dateKey) ?? zero(), raw));
          byDateStep.set(stepKey, add(byDateStep.get(stepKey) ?? zero(), raw));
          byDateStepVariant.set(
            variantKey,
            add(byDateStepVariant.get(variantKey) ?? zero(), raw),
          );
        }

        // The campaign total.
        for (const [date, raw] of byDate) {
          await repo.upsert({
            workspaceId,
            campaignId,
            stepId: null,
            variantId: null,
            date,
            counters: withDelivered(raw),
          });
          rows++;
        }

        // The per-step total.
        for (const [key, raw] of byDateStep) {
          const [date, stepId] = key.split("|");
          await repo.upsert({
            workspaceId,
            campaignId,
            stepId: stepId || null,
            variantId: null,
            date: date!,
            counters: withDelivered(raw),
          });
          rows++;
        }

        // The per-variant row.
        for (const [key, raw] of byDateStepVariant) {
          const [date, stepId, variantId] = key.split("|");
          await repo.upsert({
            workspaceId,
            campaignId,
            stepId: stepId || null,
            variantId: variantId || null,
            date: date!,
            counters: withDelivered(raw),
          });
          rows++;
        }
      }

      log.info("aggregation complete", {
        campaigns: campaigns.length,
        rows,
        from,
        to,
      });
    },
  };
}

function zero(): {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  autoReplied: number;
  bounced: number;
  unsubscribed: number;
} {
  return {
    sent: 0,
    opened: 0,
    clicked: 0,
    replied: 0,
    autoReplied: 0,
    bounced: 0,
    unsubscribed: 0,
  };
}

export type AggregationService = ReturnType<typeof createAggregationService>;
