import { Hono } from "hono";

import { created, noContent, ok } from "@/core/response";
import { parseJson, parseParams, parseQuery } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { AnalyticsService } from "./service";
import {
  activityQuerySchema,
  autoPauseRuleParamsSchema,
  campaignMetricsParamsSchema,
  createAutoPauseRuleSchema,
  dailyQuerySchema,
  exportQuerySchema,
  listAutoPauseRulesQuerySchema,
  overviewQuerySchema,
  updateAutoPauseRuleSchema,
} from "./validator";

export function createAnalyticsRoutes(
  analytics: AnalyticsService,
  requireAuth: AppMiddleware,
) {
  // NOTE: static segments must be registered before "/:id".
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/overview", async (c) => {
    const query = parseQuery(c, overviewQuerySchema);
    return ok(c, await analytics.overview(query));
  });

  routes.get("/daily", async (c) => {
    const query = parseQuery(c, dailyQuerySchema);
    return ok(c, await analytics.daily(query));
  });

  /* ------------------------------ activity ----------------------------- */

  routes.get("/activity", async (c) => {
    const query = parseQuery(c, activityQuerySchema);
    return ok(c, await analytics.activity(query));
  });

  /* ----------------------------- mailboxes ----------------------------- */

  routes.get("/mailboxes", async (c) => {
    const query = parseQuery(c, overviewQuerySchema);
    return ok(c, await analytics.mailboxes(query));
  });

  /* ------------------------------ funnels ------------------------------ */

  routes.get("/funnels", async (c) => {
    const query = parseQuery(c, overviewQuerySchema);
    const ids = (c.req.query("campaignIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ok(c, await analytics.funnels(ids, query));
  });

  routes.get("/funnels/:id", async (c) => {
    const { id } = parseParams(c, campaignMetricsParamsSchema);
    const query = parseQuery(c, overviewQuerySchema);
    return ok(c, await analytics.funnel(id, query));
  });

  /* ------------------------------ diagnose ----------------------------- */

  routes.get("/diagnose/:id", async (c) => {
    const { id } = parseParams(c, campaignMetricsParamsSchema);
    return ok(c, { diagnosis: await analytics.diagnose(id) });
  });

  /**
   * The CSV export.
   *
   * It streams as a file rather than as json, because the whole point of an
   * export is that it lands in a spreadsheet.
   */
  routes.get("/export", async (c) => {
    const query = parseQuery(c, exportQuerySchema);
    const csv = await analytics.exportCsv(query);

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `mailrung-${query.dataset}-${stamp}.csv`;

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return c.body(csv);
  });

  /* --------------------------- auto-pause ----------------------------- */

  routes.get("/auto-pause-rules", async (c) => {
    const query = parseQuery(c, listAutoPauseRulesQuerySchema);
    return ok(c, { items: await analytics.listAutoPauseRules(query) });
  });

  routes.post("/auto-pause-rules", async (c) => {
    const input = await parseJson(c, createAutoPauseRuleSchema);
    return created(c, { rule: await analytics.createAutoPauseRule(input) });
  });

  routes.get("/auto-pause-rules/history", async (c) => {
    return ok(c, { items: await analytics.autoPauseHistory() });
  });

  routes.patch("/auto-pause-rules/:id", async (c) => {
    const { id } = parseParams(c, autoPauseRuleParamsSchema);
    const input = await parseJson(c, updateAutoPauseRuleSchema);
    return ok(c, { rule: await analytics.updateAutoPauseRule(id, input) });
  });

  routes.delete("/auto-pause-rules/:id", async (c) => {
    const { id } = parseParams(c, autoPauseRuleParamsSchema);
    await analytics.removeAutoPauseRule(id);
    return noContent(c);
  });

  routes.get("/campaigns/:id", async (c) => {
    const { id } = parseParams(c, campaignMetricsParamsSchema);
    const query = parseQuery(c, overviewQuerySchema);
    return ok(c, await analytics.campaignMetrics(id, query));
  });

  return routes;
}
