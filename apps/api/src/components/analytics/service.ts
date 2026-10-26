import {
  EMPTY_FUNNEL,
  funnelRates,
  isWithinSendWindow,
  parseSchedule,
  type CampaignFunnel,
  type Diagnosis,
  type DiagnoseReason,
} from "@mailrung/shared";

import { notFound } from "@/core/errors";
import type { DbHandle } from "@/db";
import { createAnalyticsRepository } from "./repository";
import type {
  ActivityQuery,
  CreateAutoPauseRuleInput,
  ExportQuery,
  ListAutoPauseRulesQuery,
  OverviewQuery,
  UpdateAutoPauseRuleInput,
} from "./validator";

export interface AnalyticsServiceDeps {
  db: DbHandle;
  workspaceId: string | (() => Promise<string>);
}

export function createAnalyticsService(deps: AnalyticsServiceDeps) {
  const repository = createAnalyticsRepository({ db: deps.db.db });

  const ws = async () =>
    typeof deps.workspaceId === "function" ? deps.workspaceId() : deps.workspaceId;

  /** "YYYY-MM-DD" for `days` days before today. */
  function daysAgo(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** The window a query asks for, with sane defaults. */
  function window(query: { from?: string; to?: string }) {
    return {
      from: query.from ?? daysAgo(30),
      to: query.to ?? today(),
    };
  }

  return {
    /** The dashboard: totals, the daily series and the leaderboard. */
    async overview(query: OverviewQuery) {
      const workspaceId = await ws();
      const { from, to } = window(query);

      const [totals, series, leaderboard, topReplies, funnel, todayFunnel] =
        await Promise.all([
          repository.overview(workspaceId, from, to),
          repository.dailySeries(workspaceId, from, to),
          repository.campaignLeaderboard(workspaceId, from, to),
          repository.topReplies(workspaceId, from, to),
          repository.funnelForWorkspace(workspaceId, from, to),
          repository.funnelForWorkspace(workspaceId, today(), today()),
        ]);

      const todayRates = funnelRates(todayFunnel);

      return {
        from,
        to,
        totals,
        funnel,
        rates: funnelRates(funnel),
        series,
        leaderboard,
        topReplies,
        /**
         * Today alone. The dashboard leads with these, and a date range
         * cannot answer "how many did we send this morning".
         */
        today: {
          sent: todayFunnel.sent,
          opened: todayFunnel.opened,
          replied: todayFunnel.replied,
          uniqueReplies: todayFunnel.uniqueReplies,
          opportunities: todayFunnel.opportunities,
          opportunityValue: todayFunnel.opportunityValue,
          replyRate: todayRates.replyRate,
          bounceRate: todayRates.bounceRate,
        },
      };
    },

    /** One campaign's numbers: the funnel, steps, variants and the series. */
    async campaignMetrics(campaignId: string, query: OverviewQuery) {
      const workspaceId = await ws();
      const { from, to } = window(query);

      const campaign = await repository.campaignById(workspaceId, campaignId);
      if (!campaign) throw notFound("Campaign");

      const [totals, byStep, byVariant, series, funnel, progress] =
        await Promise.all([
          repository.campaignTotals(campaignId, from, to),
          repository.byStep(campaignId, from, to),
          repository.byVariant(campaignId, from, to),
          repository.campaignSeries(campaignId, from, to),
          repository.funnelFor(campaignId, from, to),
          repository.progressFor(campaignId),
        ]);

      return {
        campaign,
        from,
        to,
        totals,
        funnel,
        byStep,
        byVariant,
        series,
        progress,
        /** The rates the dashboard shows, computed once, here. */
        rates: funnelRates(funnel),
        legacyRates: {
          openRate: totals.sent > 0 ? totals.opened / totals.sent : 0,
          clickRate: totals.sent > 0 ? totals.clicked / totals.sent : 0,
          replyRate: totals.sent > 0 ? totals.replied / totals.sent : 0,
          bounceRate: totals.sent > 0 ? totals.bounced / totals.sent : 0,
        },
      };
    },

    /** The raw daily table. */
    async daily(query: Omit<ExportQuery, "dataset">) {
      const workspaceId = await ws();
      const { from, to } = window(query);
      return {
        from,
        to,
        items: await repository.dailyRows(workspaceId, { ...query, from, to }),
      };
    },

    /* ------------------------------ funnels ----------------------------- */

    /** The funnel for one campaign. */
    async funnel(campaignId: string, query: OverviewQuery) {
      const { from, to } = window(query);
      const funnel = await repository.funnelFor(campaignId, from, to);
      return { from, to, funnel, rates: funnelRates(funnel) };
    },

    /** The funnels for many campaigns, for the campaigns list. */
    async funnels(campaignIds: string[], query: OverviewQuery) {
      const { from, to } = window(query);
      const funnels = await repository.funnels(campaignIds, from, to);
      return {
        from,
        to,
        items: campaignIds.map((id) => ({
          campaignId: id,
          funnel: funnels.get(id) ?? EMPTY_FUNNEL,
        })),
      };
    },

    /* ---------------------------- activity ------------------------------ */

    /** The activity log, with filters. */
    async activity(query: ActivityQuery) {
      const workspaceId = await ws();
      const { from, to } = window(query);
      return {
        from,
        to,
        ...(await repository.activityLog(workspaceId, { ...query, from, to })),
      };
    },

    /* ----------------------------- mailboxes ---------------------------- */

    /** Per-mailbox performance. */
    async mailboxes(query: OverviewQuery) {
      const workspaceId = await ws();
      const { from, to } = window(query);
      return {
        from,
        to,
        items: await repository.mailboxMetrics(workspaceId, from, to),
      };
    },

    /* ----------------------------- diagnose ----------------------------- */

    /**
     * Why a campaign is not sending.
     *
     * The reasons are checked from the most fundamental down, so the answer
     * names the thing the operator has to change first: a draft campaign is
     * not "out of schedule", and a paused one is not "waiting for leads".
     */
    async diagnose(campaignId: string): Promise<Diagnosis> {
      const workspaceId = await ws();
      const inputs = await repository.diagnoseInputs(workspaceId, campaignId);
      if (!inputs) throw notFound("Campaign");

      const { campaign, assigned, connected, sentToday, enrolledLeads } = inputs;

      if (campaign.status === "draft") {
        return {
          reason: "campaign_draft",
          message: "This campaign has not been launched.",
          remedy: "Launch the campaign to start sending.",
        };
      }

      if (campaign.status === "paused") {
        const byRule = inputs.lastAutoPause !== null;
        return {
          reason: byRule ? "paused_by_rule" : "paused",
          message: byRule
            ? "An auto-pause rule stopped this campaign."
            : "This campaign is paused.",
          remedy: byRule
            ? "Review the auto-pause rules, then resume the campaign."
            : "Resume the campaign to start sending again.",
        };
      }

      if (campaign.status === "completed") {
        return {
          reason: "sending",
          message: "This campaign has finished.",
          remedy: null,
        };
      }

      // The mailboxes it may send from.
      const mailboxes = assigned.length > 0 ? assigned : connected;

      if (mailboxes.length === 0) {
        return {
          reason: "no_accounts_assigned",
          message: "No connected mailbox is available to send from.",
          remedy: "Connect a mailbox, or assign one to this campaign.",
        };
      }

      const healthy = mailboxes.filter(
        (m) => m.status === "connected" && m.healthScore >= 40,
      );
      if (healthy.length === 0) {
        return {
          reason: "all_accounts_unhealthy",
          message: "Every mailbox assigned to this campaign is unhealthy.",
          remedy: "Reconnect a mailbox, or wait for its health to recover.",
        };
      }

      const schedule = parseSchedule(campaign.schedule);
      if (!isWithinSendWindow(schedule, new Date(), inputs.timezone)) {
        return {
          reason: "out_of_schedule",
          message: "The campaign is outside its sending window.",
          remedy: "Widen the schedule, or wait for the window to open.",
        };
      }

      const dailyLimit = campaign.dailyLimit;
      if (dailyLimit !== null && sentToday >= dailyLimit) {
        return {
          reason: "daily_limit_met",
          message: `The daily limit of ${dailyLimit} emails has been reached.`,
          remedy: "Raise the daily limit, or wait for tomorrow.",
        };
      }

      if (enrolledLeads === 0) {
        return {
          reason: "waiting_for_leads",
          message: "No active leads are enrolled in this campaign.",
          remedy: "Enroll some leads to start sending.",
        };
      }

      return {
        reason: "sending",
        message: "The campaign is sending.",
        remedy: null,
      };
    },

    /* ------------------------------ export ------------------------------ */

    /**
     * A CSV of the activity log or the daily rollup.
     *
     * The export is generated here rather than in the browser so it can
     * cover the whole range, not just the page on screen.
     */
    async exportCsv(query: ExportQuery): Promise<string> {
      const workspaceId = await ws();
      const { from, to } = window(query);

      if (query.dataset === "daily") {
        const rows = await repository.dailyExportRows(workspaceId, {
          ...query,
          from,
          to,
        });

        const columns: CsvColumn[] = [
          { header: "date", value: (r) => r.date },
          { header: "campaign_id", value: (r) => r.campaignId },
          { header: "step_id", value: (r) => r.stepId },
          { header: "variant_id", value: (r) => r.variantId },
          { header: "sent", value: (r) => r.sent },
          { header: "delivered", value: (r) => r.delivered },
          { header: "opened", value: (r) => r.opened },
          { header: "clicked", value: (r) => r.clicked },
          { header: "replied", value: (r) => r.replied },
          { header: "auto_replied", value: (r) => r.autoReplied },
          { header: "bounced", value: (r) => r.bounced },
          { header: "unsubscribed", value: (r) => r.unsubscribed },
        ];

        return toCsv(columns, rows as unknown as Record<string, unknown>[]);
      }

      const rows = await repository.activityRows(workspaceId, {
        ...query,
        from,
        to,
      });

      const columns: CsvColumn[] = [
        {
          header: "created_at",
          value: (r) =>
            r.createdAt instanceof Date
              ? r.createdAt.toISOString()
              : String(r.createdAt ?? ""),
        },
        { header: "type", value: (r) => r.type },
        { header: "campaign_id", value: (r) => r.campaignId },
        { header: "lead_id", value: (r) => r.leadId },
        { header: "mailbox_id", value: (r) => r.mailboxId },
        { header: "step_id", value: (r) => r.stepId },
        { header: "variant_id", value: (r) => r.variantId },
        { header: "meta", value: (r) => JSON.stringify(r.meta ?? {}) },
      ];

      return toCsv(columns, rows as unknown as Record<string, unknown>[]);
    },

    /* --------------------------- auto-pause ----------------------------- */

    async listAutoPauseRules(query: ListAutoPauseRulesQuery) {
      return repository.listAutoPauseRules(await ws(), query.campaignId);
    },

    async createAutoPauseRule(input: CreateAutoPauseRuleInput) {
      return repository.createAutoPauseRule({
        workspaceId: await ws(),
        campaignId: input.campaignId ?? null,
        metric: input.metric,
        threshold: input.threshold,
        direction: input.direction,
        action: input.action,
        enabled: input.enabled ? 1 : 0,
      });
    },

    async updateAutoPauseRule(id: string, input: UpdateAutoPauseRuleInput) {
      const existing = await repository.autoPauseRuleById(await ws(), id);
      if (!existing) throw notFound("Auto-pause rule");

      const patch: Record<string, unknown> = {};
      if (input.campaignId !== undefined) patch.campaignId = input.campaignId;
      if (input.metric !== undefined) patch.metric = input.metric;
      if (input.threshold !== undefined) patch.threshold = input.threshold;
      if (input.direction !== undefined) patch.direction = input.direction;
      if (input.action !== undefined) patch.action = input.action;
      if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0;

      return repository.updateAutoPauseRule(id, patch);
    },

    async removeAutoPauseRule(id: string) {
      const existing = await repository.autoPauseRuleById(await ws(), id);
      if (!existing) throw notFound("Auto-pause rule");
      await repository.removeAutoPauseRule(id);
    },

    async autoPauseHistory(ruleId?: string) {
      return repository.autoPauseEvents(await ws(), ruleId);
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;

/** One column of a CSV. */
type CsvColumn = {
  header: string;
  value: (row: Record<string, unknown>) => unknown;
};

/**
 * Builds a CSV from a column list.
 *
 * Every value is quoted and internal quotes are doubled, so a subject line
 * containing a comma or a newline cannot break the file.
 */
export function toCsv(
  columns: CsvColumn[],
  rows: Record<string, unknown>[],
): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '""';
    const text =
      value instanceof Date ? value.toISOString() : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [columns.map((c) => escape(c.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((c) => escape(c.value(row))).join(","));
  }

  return lines.join("\r\n");
}

export type { CampaignFunnel, Diagnosis, DiagnoseReason };
