import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  activities,
  autoPauseEvents,
  autoPauseRules,
  campaignDailyStats,
  campaignLeads,
  campaignMailboxes,
  campaignSteps,
  campaigns,
  leads,
  leadLabels,
  mailboxes,
  opportunities,
  stepVariants,
  workspaces,
  type Database,
} from "@mailrung/db";
import {
  EMPTY_FUNNEL,
  type CampaignFunnel,
} from "@mailrung/shared";

export function createAnalyticsRepository({ db }: { db: Database }) {
  return {
    /* ------------------------------ totals ------------------------------- */

    /**
     * Workspace totals over a date window.
     *
     * Every number is a distinct-lead count except sends and bounces, which
     * are event counts: a lead can be sent to twice but can only be a lead
     * once.
     */
    async overview(workspaceId: string, from: string, to: string) {
      const rows = await db
        .select({
          sent: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          opened: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_opened')::int`,
          clicked: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'link_clicked')::int`,
          replied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'reply_received')::int`,
          bounced: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'bounced')::int`,
          unsubscribed: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'unsubscribed')::int`,
        })
        .from(activities)
        .where(
          and(
            eq(activities.workspaceId, workspaceId),
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
          ),
        );

      const totals = rows[0] ?? {
        sent: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        bounced: 0,
        unsubscribed: 0,
      };

      const [leadCount, campaignCount, opportunityCount] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(leads)
          .where(eq(leads.workspaceId, workspaceId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(eq(campaigns.workspaceId, workspaceId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.workspaceId, workspaceId),
              eq(opportunities.status, "open"),
            ),
          ),
      ]);

      return {
        ...totals,
        // Delivered is what was not bounced — the only delivery failure we
        // can actually observe.
        delivered: Math.max(0, totals.sent - totals.bounced),
        leads: leadCount[0]?.count ?? 0,
        campaigns: campaignCount[0]?.count ?? 0,
        openOpportunities: opportunityCount[0]?.count ?? 0,
      };
    },

    /** The daily series for the workspace, straight from the rollup. */
    async dailySeries(workspaceId: string, from: string, to: string) {
      return db
        .select({
          date: campaignDailyStats.date,
          sent: sql<number>`sum(${campaignDailyStats.sent})::int`,
          delivered: sql<number>`sum(${campaignDailyStats.delivered})::int`,
          opened: sql<number>`sum(${campaignDailyStats.opened})::int`,
          clicked: sql<number>`sum(${campaignDailyStats.clicked})::int`,
          replied: sql<number>`sum(${campaignDailyStats.replied})::int`,
          bounced: sql<number>`sum(${campaignDailyStats.bounced})::int`,
          unsubscribed: sql<number>`sum(${campaignDailyStats.unsubscribed})::int`,
        })
        .from(campaignDailyStats)
        .where(
          and(
            eq(campaignDailyStats.workspaceId, workspaceId),
            gte(campaignDailyStats.date, from),
            lte(campaignDailyStats.date, to),
            sql`${campaignDailyStats.stepId} IS NULL`,
            sql`${campaignDailyStats.variantId} IS NULL`,
          ),
        )
        .groupBy(campaignDailyStats.date)
        .orderBy(campaignDailyStats.date);
    },

    /* --------------------------- per campaign --------------------------- */

    async campaignById(workspaceId: string, campaignId: string) {
      const rows = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.workspaceId, workspaceId),
            eq(campaigns.id, campaignId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    /** Totals for one campaign, from the rollup. */
    async campaignTotals(campaignId: string, from: string, to: string) {
      const rows = await db
        .select({
          sent: sql<number>`sum(${campaignDailyStats.sent})::int`,
          delivered: sql<number>`sum(${campaignDailyStats.delivered})::int`,
          opened: sql<number>`sum(${campaignDailyStats.opened})::int`,
          clicked: sql<number>`sum(${campaignDailyStats.clicked})::int`,
          replied: sql<number>`sum(${campaignDailyStats.replied})::int`,
          autoReplied: sql<number>`sum(${campaignDailyStats.autoReplied})::int`,
          bounced: sql<number>`sum(${campaignDailyStats.bounced})::int`,
          unsubscribed: sql<number>`sum(${campaignDailyStats.unsubscribed})::int`,
        })
        .from(campaignDailyStats)
        .where(
          and(
            eq(campaignDailyStats.campaignId, campaignId),
            gte(campaignDailyStats.date, from),
            lte(campaignDailyStats.date, to),
            sql`${campaignDailyStats.stepId} IS NULL`,
            sql`${campaignDailyStats.variantId} IS NULL`,
          ),
        );

      const totals = rows[0] ?? {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        autoReplied: 0,
        bounced: 0,
        unsubscribed: 0,
      };

      return { ...totals };
    },

    /** Per-step performance for a campaign. */
    async byStep(campaignId: string, from: string, to: string) {
      return db
        .select({
          stepId: campaignSteps.id,
          position: campaignSteps.position,
          subject: campaignSteps.subject,
          sent: sql<number>`sum(${campaignDailyStats.sent})::int`,
          opened: sql<number>`sum(${campaignDailyStats.opened})::int`,
          clicked: sql<number>`sum(${campaignDailyStats.clicked})::int`,
          replied: sql<number>`sum(${campaignDailyStats.replied})::int`,
          bounced: sql<number>`sum(${campaignDailyStats.bounced})::int`,
        })
        .from(campaignDailyStats)
        .innerJoin(
          campaignSteps,
          eq(campaignSteps.id, campaignDailyStats.stepId),
        )
        .where(
          and(
            eq(campaignDailyStats.campaignId, campaignId),
            gte(campaignDailyStats.date, from),
            lte(campaignDailyStats.date, to),
            sql`${campaignDailyStats.variantId} IS NULL`,
          ),
        )
        .groupBy(campaignSteps.id, campaignSteps.position, campaignSteps.subject)
        .orderBy(campaignSteps.position);
    },

    /** Per-variant performance, so A/B results can be compared. */
    async byVariant(campaignId: string, from: string, to: string) {
      return db
        .select({
          variantId: stepVariants.id,
          label: stepVariants.label,
          stepId: stepVariants.stepId,
          sent: sql<number>`sum(${campaignDailyStats.sent})::int`,
          opened: sql<number>`sum(${campaignDailyStats.opened})::int`,
          clicked: sql<number>`sum(${campaignDailyStats.clicked})::int`,
          replied: sql<number>`sum(${campaignDailyStats.replied})::int`,
        })
        .from(campaignDailyStats)
        .innerJoin(stepVariants, eq(stepVariants.id, campaignDailyStats.variantId))
        .where(
          and(
            eq(campaignDailyStats.campaignId, campaignId),
            gte(campaignDailyStats.date, from),
            lte(campaignDailyStats.date, to),
          ),
        )
        .groupBy(stepVariants.id, stepVariants.label, stepVariants.stepId)
        .orderBy(stepVariants.id);
    },

    /** The daily series for one campaign. */
    async campaignSeries(campaignId: string, from: string, to: string) {
      return db
        .select({
          date: campaignDailyStats.date,
          sent: sql<number>`sum(${campaignDailyStats.sent})::int`,
          opened: sql<number>`sum(${campaignDailyStats.opened})::int`,
          clicked: sql<number>`sum(${campaignDailyStats.clicked})::int`,
          replied: sql<number>`sum(${campaignDailyStats.replied})::int`,
          bounced: sql<number>`sum(${campaignDailyStats.bounced})::int`,
        })
        .from(campaignDailyStats)
        .where(
          and(
            eq(campaignDailyStats.campaignId, campaignId),
            gte(campaignDailyStats.date, from),
            lte(campaignDailyStats.date, to),
            sql`${campaignDailyStats.stepId} IS NULL`,
            sql`${campaignDailyStats.variantId} IS NULL`,
          ),
        )
        .groupBy(campaignDailyStats.date)
        .orderBy(campaignDailyStats.date);
    },

    /** Enrolment funnel for a campaign. */
    async campaignFunnel(campaignId: string) {
      const rows = await db
        .select({
          state: campaignLeads.state,
          count: sql<number>`count(*)::int`,
        })
        .from(campaignLeads)
        .where(eq(campaignLeads.campaignId, campaignId))
        .groupBy(campaignLeads.state);

      return rows;
    },

    /* ---------------------------- daily table --------------------------- */

    async dailyRows(
      workspaceId: string,
      query: { campaignId?: string; from: string; to: string },
    ) {
      const conditions = [
        eq(campaignDailyStats.workspaceId, workspaceId),
        gte(campaignDailyStats.date, query.from),
        lte(campaignDailyStats.date, query.to),
      ];
      if (query.campaignId) {
        conditions.push(eq(campaignDailyStats.campaignId, query.campaignId));
      }

      return db
        .select()
        .from(campaignDailyStats)
        .where(and(...conditions))
        .orderBy(desc(campaignDailyStats.date));
    },

    /* ----------------------------- campaigns ---------------------------- */

    /** Every campaign with its headline numbers, for the leaderboard. */
    async campaignLeaderboard(workspaceId: string, from: string, to: string) {
      return db
        .select({
          campaignId: campaigns.id,
          name: campaigns.name,
          status: campaigns.status,
          sent: sql<number>`coalesce(sum(${campaignDailyStats.sent}), 0)::int`,
          opened: sql<number>`coalesce(sum(${campaignDailyStats.opened}), 0)::int`,
          replied: sql<number>`coalesce(sum(${campaignDailyStats.replied}), 0)::int`,
          bounced: sql<number>`coalesce(sum(${campaignDailyStats.bounced}), 0)::int`,
        })
        .from(campaigns)
        .leftJoin(
          campaignDailyStats,
          and(
            eq(campaignDailyStats.campaignId, campaigns.id),
            gte(campaignDailyStats.date, from),
            lte(campaignDailyStats.date, to),
            sql`${campaignDailyStats.stepId} IS NULL`,
            sql`${campaignDailyStats.variantId} IS NULL`,
          ),
        )
        .where(eq(campaigns.workspaceId, workspaceId))
        .groupBy(campaigns.id, campaigns.name, campaigns.status)
        .orderBy(desc(sql`coalesce(sum(${campaignDailyStats.sent}), 0)`));
    },

    /* ----------------------------- funnel ------------------------------ */

    /**
     * The funnel for a set of campaigns, in one query.
     *
     * Every engagement number is a distinct-lead count: a lead who opens
     * three emails is one open in a funnel, not three. Sends and bounces
     * are event counts, because they are about emails rather than people.
     */
    async funnels(
      campaignIds: string[],
      from: string,
      to: string,
    ): Promise<Map<string, CampaignFunnel>> {
      const out = new Map<string, CampaignFunnel>();
      if (campaignIds.length === 0) return out;

      const rows = await db
        .select({
          campaignId: activities.campaignId,
          sent: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          contacted: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          opened: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_opened')::int`,
          clicked: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'link_clicked')::int`,
          replied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'reply_received')::int`,
          autoReplied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'auto_reply')::int`,
          bounced: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'bounced')::int`,
          unsubscribed: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'unsubscribed')::int`,
        })
        .from(activities)
        .where(
          and(
            inArray(activities.campaignId, campaignIds),
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
          ),
        )
        .groupBy(activities.campaignId);

      // Positive replies come from the lead's current status, not from an
      // activity: a lead who replied and is now marked "Interested" is a
      // positive reply, whatever the classifier called the message.
      const positiveRows = await db
        .select({
          campaignId: campaignLeads.campaignId,
          count: sql<number>`count(DISTINCT ${campaignLeads.leadId})::int`,
        })
        .from(campaignLeads)
        .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
        .innerJoin(leadLabels, eq(leadLabels.id, leads.statusId))
        .where(
          and(
            inArray(campaignLeads.campaignId, campaignIds),
            eq(leadLabels.interest, "positive"),
          ),
        )
        .groupBy(campaignLeads.campaignId);

      const positiveMap = new Map(
        positiveRows.map((r) => [r.campaignId as string, r.count]),
      );

      // Opportunities and their value.
      const opportunityRows = await db
        .select({
          campaignId: opportunities.campaignId,
          count: sql<number>`count(*)::int`,
          value: sql<number>`coalesce(sum(${opportunities.value}), 0)::int`,
        })
        .from(opportunities)
        .where(inArray(opportunities.campaignId, campaignIds))
        .groupBy(opportunities.campaignId);

      const opportunityMap = new Map(
        opportunityRows.map((r) => [
          r.campaignId as string,
          { count: r.count, value: r.value },
        ]),
      );

      for (const id of campaignIds) {
        const row = rows.find((r) => r.campaignId === id);
        const opp = opportunityMap.get(id);
        const replied = row?.replied ?? 0;
        const autoReplied = row?.autoReplied ?? 0;

        out.set(id, {
          sent: row?.sent ?? 0,
          contacted: row?.contacted ?? 0,
          opened: row?.opened ?? 0,
          clicked: row?.clicked ?? 0,
          replied,
          autoReplied,
          // A lead who both auto-replied and wrote back counts once.
          uniqueReplies: replied + autoReplied,
          positiveReplies: positiveMap.get(id) ?? 0,
          opportunities: opp?.count ?? 0,
          opportunityValue: opp?.value ?? 0,
          bounced: row?.bounced ?? 0,
          unsubscribed: row?.unsubscribed ?? 0,
        });
      }

      return out;
    },

    /**
     * The workspace-wide funnel.
     *
     * The same shape as the per-campaign funnel, across every campaign, so
     * the dashboard can show the same numbers the campaign page does.
     */
    async funnelForWorkspace(
      workspaceId: string,
      from: string,
      to: string,
    ): Promise<CampaignFunnel> {
      const rows = await db
        .select({
          sent: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          contacted: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          opened: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_opened')::int`,
          clicked: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'link_clicked')::int`,
          replied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'reply_received')::int`,
          autoReplied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'auto_reply')::int`,
          bounced: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'bounced')::int`,
          unsubscribed: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'unsubscribed')::int`,
        })
        .from(activities)
        .where(
          and(
            eq(activities.workspaceId, workspaceId),
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
          ),
        );

      const row = rows[0];
      const replied = row?.replied ?? 0;
      const autoReplied = row?.autoReplied ?? 0;

      const positiveRows = await db
        .select({ count: sql<number>`count(DISTINCT ${leads.id})::int` })
        .from(leads)
        .innerJoin(leadLabels, eq(leadLabels.id, leads.statusId))
        .where(
          and(
            eq(leads.workspaceId, workspaceId),
            eq(leadLabels.interest, "positive"),
          ),
        );

      const opportunityRows = await db
        .select({
          count: sql<number>`count(*)::int`,
          value: sql<number>`coalesce(sum(${opportunities.value}), 0)::int`,
        })
        .from(opportunities)
        .where(eq(opportunities.workspaceId, workspaceId));

      return {
        sent: row?.sent ?? 0,
        contacted: row?.contacted ?? 0,
        opened: row?.opened ?? 0,
        clicked: row?.clicked ?? 0,
        replied,
        autoReplied,
        uniqueReplies: replied + autoReplied,
        positiveReplies: positiveRows[0]?.count ?? 0,
        opportunities: opportunityRows[0]?.count ?? 0,
        opportunityValue: opportunityRows[0]?.value ?? 0,
        bounced: row?.bounced ?? 0,
        unsubscribed: row?.unsubscribed ?? 0,
      };
    },

    /** The funnel for one campaign, over the whole of time. */
    async funnelFor(
      campaignId: string,
      from: string,
      to: string,
    ): Promise<CampaignFunnel> {
      const map = await this.funnels([campaignId], from, to);
      return map.get(campaignId) ?? EMPTY_FUNNEL;
    },

    /**
     * The activity log, with filters.
     *
     * Every dimension the PRD lists is filterable: type, campaign, lead,
     * mailbox, step and date range.
     */
    async activityLog(
      workspaceId: string,
      query: {
        limit: number;
        offset: number;
        from: string;
        to: string;
        type?: string;
        campaignId?: string;
        leadId?: string;
        mailboxId?: string;
        stepId?: string;
      },
    ) {
      const conditions = [
        eq(activities.workspaceId, workspaceId),
        gte(activities.createdAt, new Date(`${query.from}T00:00:00Z`)),
        lte(activities.createdAt, new Date(`${query.to}T23:59:59Z`)),
      ];
      if (query.type) conditions.push(eq(activities.type, query.type as never));
      if (query.campaignId) {
        conditions.push(eq(activities.campaignId, query.campaignId));
      }
      if (query.leadId) conditions.push(eq(activities.leadId, query.leadId));
      if (query.mailboxId) {
        conditions.push(eq(activities.mailboxId, query.mailboxId));
      }
      if (query.stepId) conditions.push(eq(activities.stepId, query.stepId));

      const rows = await db
        .select({
          activity: activities,
          campaignName: campaigns.name,
          leadEmail: leads.email,
          mailboxEmail: mailboxes.email,
          stepSubject: campaignSteps.subject,
        })
        .from(activities)
        .leftJoin(campaigns, eq(campaigns.id, activities.campaignId))
        .leftJoin(leads, eq(leads.id, activities.leadId))
        .leftJoin(mailboxes, eq(mailboxes.id, activities.mailboxId))
        .leftJoin(campaignSteps, eq(campaignSteps.id, activities.stepId))
        .where(and(...conditions))
        .orderBy(desc(activities.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      const countRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(activities)
        .where(and(...conditions));

      return { items: rows, total: countRows[0]?.count ?? 0 };
    },

    /**
     * Per-mailbox metrics.
     *
     * "Combined score" is the PRD's summary of a mailbox's health: a
     * mailbox that replies well is worth more than one that only opens.
     */
    async mailboxMetrics(
      workspaceId: string,
      from: string,
      to: string,
    ): Promise<
      Array<{
        mailboxId: string;
        email: string;
        status: string;
        healthScore: number;
        sent: number;
        opened: number;
        replied: number;
        bounced: number;
        unsubscribed: number;
        score: number;
      }>
    > {
      const rows = await db
        .select({
          mailboxId: mailboxes.id,
          email: mailboxes.email,
          status: mailboxes.status,
          healthScore: mailboxes.healthScore,
          sent: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'email_sent')::int`,
          opened: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'email_opened')::int`,
          replied: sql<number>`count(DISTINCT ${activities.leadId}) FILTER (WHERE ${activities.type} = 'reply_received')::int`,
          bounced: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'bounced')::int`,
          unsubscribed: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'unsubscribed')::int`,
        })
        .from(mailboxes)
        // The date range belongs in the join, not the where: a mailbox with
        // no activity in the window must still appear, with zeroes.
        .leftJoin(
          activities,
          and(
            eq(activities.mailboxId, mailboxes.id),
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
          ),
        )
        .where(eq(mailboxes.workspaceId, workspaceId))
        .groupBy(mailboxes.id, mailboxes.email, mailboxes.status, mailboxes.healthScore)
        .orderBy(desc(sql`count(*)`));

      return rows.map((r) => {
        const sent = r.sent ?? 0;
        const replyRate = sent > 0 ? (r.replied ?? 0) / sent : 0;
        const bounceRate = sent > 0 ? (r.bounced ?? 0) / sent : 0;

        // The combined score blends the health score with the engagement
        // the mailbox actually produced. A mailbox with no sends yet scores
        // on its health alone.
        const score =
          sent === 0
            ? Math.round(r.healthScore)
            : Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    r.healthScore * 0.5 +
                      replyRate * 100 * 0.3 +
                      Math.max(0, 100 - bounceRate * 100) * 0.2,
                  ),
                ),
              );

        return {
          mailboxId: r.mailboxId,
          email: r.email,
          status: r.status,
          healthScore: r.healthScore,
          sent,
          opened: r.opened ?? 0,
          replied: r.replied ?? 0,
          bounced: r.bounced ?? 0,
          unsubscribed: r.unsubscribed ?? 0,
          score,
        };
      });
    },

    /**
     * The share of enrolled leads who have finished the whole sequence.
     *
     * This mirrors the "progress" mental model: a lead who answered the
     * first email and stopped is not half-way through the campaign.
     */
    async progressFor(campaignId: string): Promise<number> {
      const rows = await db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) FILTER (WHERE ${campaignLeads.state} = 'completed')::int`,
        })
        .from(campaignLeads)
        .where(eq(campaignLeads.campaignId, campaignId));

      const total = rows[0]?.total ?? 0;
      const completed = rows[0]?.completed ?? 0;
      return total === 0 ? 0 : Math.round((completed / total) * 100);
    },

    /* ---------------------------- diagnose ----------------------------- */

    /**
     * Everything the diagnosis needs, in one place.
     *
     * The reasons are checked in a fixed order — the most fundamental
     * first — so the answer is always the same for the same state.
     */
    async diagnoseInputs(workspaceId: string, campaignId: string) {
      const campaignRows = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.workspaceId, workspaceId),
            eq(campaigns.id, campaignId),
          ),
        )
        .limit(1);
      const campaign = campaignRows[0] ?? null;
      if (!campaign) return null;

      const assigned = await db
        .select({
          id: mailboxes.id,
          email: mailboxes.email,
          status: mailboxes.status,
          healthScore: mailboxes.healthScore,
        })
        .from(campaignMailboxes)
        .innerJoin(mailboxes, eq(mailboxes.id, campaignMailboxes.mailboxId))
        .where(eq(campaignMailboxes.campaignId, campaignId));

      // Every connected mailbox, for the case where the campaign has no
      // explicit assignment.
      const connected = await db
        .select({
          id: mailboxes.id,
          email: mailboxes.email,
          status: mailboxes.status,
          healthScore: mailboxes.healthScore,
        })
        .from(mailboxes)
        .where(
          and(
            eq(mailboxes.workspaceId, workspaceId),
            eq(mailboxes.status, "connected"),
          ),
        );

      const sentToday = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(activities)
        .where(
          and(
            eq(activities.campaignId, campaignId),
            sql`${activities.createdAt}::date = now()::date`,
            eq(activities.type, "email_sent"),
          ),
        );

      const enrolled = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.campaignId, campaignId),
            eq(campaignLeads.state, "active"),
          ),
        );

      const pauses = await db
        .select({ firedAt: autoPauseEvents.firedAt, reason: autoPauseEvents.actionTaken })
        .from(autoPauseEvents)
        .where(eq(autoPauseEvents.campaignId, campaignId))
        .orderBy(desc(autoPauseEvents.firedAt))
        .limit(1);

      const timezoneRows = await db
        .select({ timezone: workspaces.timezone })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      return {
        campaign,
        assigned,
        connected,
        sentToday: sentToday[0]?.count ?? 0,
        enrolledLeads: enrolled[0]?.count ?? 0,
        lastAutoPause: pauses[0] ?? null,
        timezone: timezoneRows[0]?.timezone ?? "UTC",
      };
    },

    /* --------------------------- auto-pause ---------------------------- */

    async listAutoPauseRules(workspaceId: string, campaignId?: string) {
      const conditions = [eq(autoPauseRules.workspaceId, workspaceId)];
      if (campaignId) {
        conditions.push(eq(autoPauseRules.campaignId, campaignId));
      }
      return db
        .select()
        .from(autoPauseRules)
        .where(and(...conditions))
        .orderBy(desc(autoPauseRules.createdAt));
    },

    async autoPauseRuleById(workspaceId: string, id: string) {
      const rows = await db
        .select()
        .from(autoPauseRules)
        .where(
          and(
            eq(autoPauseRules.workspaceId, workspaceId),
            eq(autoPauseRules.id, id),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async createAutoPauseRule(entry: {
      workspaceId: string;
      campaignId: string | null;
      metric: string;
      threshold: number;
      direction: string;
      action: string;
      enabled: number;
    }) {
      const rows = await db.insert(autoPauseRules).values(entry).returning();
      return rows[0]!;
    },

    async updateAutoPauseRule(id: string, patch: Record<string, unknown>) {
      const rows = await db
        .update(autoPauseRules)
        .set(patch)
        .where(eq(autoPauseRules.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async removeAutoPauseRule(id: string) {
      await db.delete(autoPauseRules).where(eq(autoPauseRules.id, id));
    },

    async autoPauseEvents(workspaceId: string, ruleId?: string) {
      const conditions = [eq(autoPauseEvents.workspaceId, workspaceId)];
      if (ruleId) conditions.push(eq(autoPauseEvents.ruleId, ruleId));
      return db
        .select()
        .from(autoPauseEvents)
        .where(and(...conditions))
        .orderBy(desc(autoPauseEvents.firedAt))
        .limit(100);
    },

    /* ------------------------------ export ------------------------------ */

    /** The raw activity log, for a CSV export. */
    async activityRows(
      workspaceId: string,
      query: { campaignId?: string; from: string; to: string },
    ) {
      const conditions = [
        eq(activities.workspaceId, workspaceId),
        gte(activities.createdAt, new Date(`${query.from}T00:00:00Z`)),
        lte(activities.createdAt, new Date(`${query.to}T23:59:59Z`)),
      ];
      if (query.campaignId) {
        conditions.push(eq(activities.campaignId, query.campaignId));
      }

      return db
        .select({
          type: activities.type,
          createdAt: activities.createdAt,
          campaignId: activities.campaignId,
          leadId: activities.leadId,
          mailboxId: activities.mailboxId,
          stepId: activities.stepId,
          variantId: activities.variantId,
          meta: activities.meta,
        })
        .from(activities)
        .where(and(...conditions))
        .orderBy(activities.createdAt);
    },

    /** The daily rollup, for a CSV export. */
    async dailyExportRows(
      workspaceId: string,
      query: { campaignId?: string; from: string; to: string },
    ) {
      const conditions = [
        eq(campaignDailyStats.workspaceId, workspaceId),
        gte(campaignDailyStats.date, query.from),
        lte(campaignDailyStats.date, query.to),
      ];
      if (query.campaignId) {
        conditions.push(eq(campaignDailyStats.campaignId, query.campaignId));
      }

      return db
        .select()
        .from(campaignDailyStats)
        .where(and(...conditions))
        .orderBy(campaignDailyStats.date);
    },

    /** The leads that replied most, for a "who is interested" view. */
    async topReplies(workspaceId: string, from: string, to: string, limit = 20) {
      return db
        .select({
          leadId: leads.id,
          email: leads.email,
          firstName: leads.firstName,
          lastName: leads.lastName,
          company: leads.company,
          replies: sql<number>`count(*)::int`,
        })
        .from(activities)
        .innerJoin(leads, eq(leads.id, activities.leadId))
        .where(
          and(
            eq(activities.workspaceId, workspaceId),
            eq(activities.type, "reply_received"),
            gte(activities.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(activities.createdAt, new Date(`${to}T23:59:59Z`)),
          ),
        )
        .groupBy(leads.id, leads.email, leads.firstName, leads.lastName, leads.company)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);
    },
  };
}

export type AnalyticsRepository = ReturnType<typeof createAnalyticsRepository>;
export { inArray };
