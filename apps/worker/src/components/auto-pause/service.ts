import type { Logger } from "@/core/logger";
import {
  createAutoPauseRepository,
  type AutoPauseRepository,
} from "./repository";

export interface AutoPauseServiceDeps {
  db: { db: Parameters<typeof createAutoPauseRepository>[0]["db"] };
  log: Logger;
  /** How many days of activity a rule looks at. */
  windowDays?: number;
}

/**
 * The metric a rule watches, and how it is compared to the threshold.
 *
 * "above" fires when the metric rises past the threshold — a bounce rate
 * climbing. "below" fires when it falls under — a reply rate collapsing.
 */
export function isBreached(
  value: number,
  threshold: number,
  direction: string,
): boolean {
  if (direction === "below") return value < threshold;
  return value > threshold;
}

export function createAutoPauseService(deps: AutoPauseServiceDeps) {
  const repo: AutoPauseRepository = createAutoPauseRepository({
    db: deps.db.db,
  });
  const { log } = deps;
  const windowDays = deps.windowDays ?? 7;

  return {
    /**
     * Evaluates every rule against every active campaign.
     *
     * A rule fires at most once per campaign per run: the campaign is
     * paused, and a paused campaign is not evaluated again until someone
     * resumes it. That is what makes the rule safe to run on every tick.
     */
    async run(): Promise<void> {
      const active = await repo.activeCampaigns();
      if (active.length === 0) return;

      let fired = 0;

      for (const campaign of active) {
        const rules = await repo.rulesFor(campaign.id);
        if (rules.length === 0) continue;

        for (const rule of rules) {
          const value = await repo.metricValue(
            campaign.id,
            rule.metric,
            windowDays,
          );

          // No metric means no judgement. A campaign with nothing sent yet
          // must not be paused for a rate it does not have.
          if (value === null) continue;

          if (!isBreached(value, rule.threshold, rule.direction)) continue;

          const reason = describe(rule.metric, value, rule.threshold, rule.direction);

          await repo.pauseCampaign(campaign.id, reason);
          await repo.recordEvent({
            workspaceId: rule.workspaceId,
            ruleId: rule.id,
            campaignId: campaign.id,
            metricValue: value,
            actionTaken: rule.action,
          });
          await repo.markRuleFired(rule.id);
          await repo.recordActivity({
            workspaceId: rule.workspaceId,
            campaignId: campaign.id,
            leadId: null,
            mailboxId: null,
            stepId: null,
            variantId: null,
            type: "status_changed",
            meta: { autoPaused: true, reason, ruleId: rule.id },
          });

          fired++;
          log.warn("campaign auto-paused", {
            campaignId: campaign.id,
            campaignName: campaign.name,
            ruleId: rule.id,
            metric: rule.metric,
            value: Number(value.toFixed(2)),
            threshold: rule.threshold,
          });
        }
      }

      if (fired > 0) {
        log.info("auto-pause pass complete", { fired });
      }
    },
  };
}

export type AutoPauseService = ReturnType<typeof createAutoPauseService>;

/** A sentence explaining why a campaign was paused. */
export function describe(
  metric: string,
  value: number,
  threshold: number,
  direction: string,
): string {
  const labels: Record<string, string> = {
    bounce_rate: "bounce rate",
    reply_rate: "reply rate",
    open_rate: "open rate",
    spam_rate: "spam rate",
    mailbox_health: "mailbox health",
  };

  const name = labels[metric] ?? metric;
  const pct = metric === "mailbox_health" ? "" : "%";
  const rounded = Number(value.toFixed(2));

  return direction === "below"
    ? `Auto-paused: ${name} fell to ${rounded}${pct}, below ${threshold}${pct}.`
    : `Auto-paused: ${name} reached ${rounded}${pct}, above ${threshold}${pct}.`;
}
