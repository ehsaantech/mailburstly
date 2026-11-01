import { Hono } from "hono";

import type { AppBindings, AppContext } from "@/types";
import type { Logger } from "@/core/logger";
import type { DbHandle } from "@/db";
import { notImplemented } from "@/core/errors";
import { env } from "@/env";
import { createAuthService } from "@/components/auth/service";
import { createAuthRoutes } from "@/components/auth/controller";
import { createUserRepository } from "@/components/auth/repository";
import { createRequireAuth } from "@/middleware/auth";
import { createMailboxService } from "@/components/mailboxes/service";
import { createMailboxRoutes } from "@/components/mailboxes/controller";
import { createCampaignRoutes } from "@/components/campaigns/controller";
import { createLeadRoutes } from "@/components/leads/controller";
import { createLeadService } from "@/components/leads/service";
import { createCampaignService } from "@/components/campaigns/service";
import { createWorkspaceRepository } from "@/components/workspace/repository";
import { createWorkspaceRoutes } from "@/components/workspace/controller";
import { createInboxService } from "@/components/inbox/service";
import { createInboxRoutes } from "@/components/inbox/controller";
import { createAnalyticsService } from "@/components/analytics/service";
import { createAnalyticsRoutes } from "@/components/analytics/controller";
import { createWebhookService } from "@/components/webhooks/service";
import { createWebhookRoutes } from "@/components/webhooks/controller";
import { createSubsequenceService } from "@/components/subsequences/service";
import { createSubsequenceRoutes } from "@/components/subsequences/controller";
import { createPublicApiService } from "@/components/public-api/service";
import { createPublicApiRoutes } from "@/components/public-api/controller";
import { createSettingsService } from "@/components/settings/service";
import { createNotificationService } from "@/components/notifications/service";
import { createNotificationRoutes } from "@/components/notifications/controller";
import { createSettingsRoutes } from "@/components/settings/controller";
import { createListService } from "@/components/lists/service";
import { createListRoutes } from "@/components/lists/controller";
import { createAlertRecipientsService } from "@/components/alert-recipients/service";
import { createAlertRecipientRoutes } from "@/components/alert-recipients/controller";
import { createApiKeyAuth } from "@/middleware/api-key";

/**
 * Composition root.
 *
 * Dependencies flow one way and are wired only here:
 *
 *   db ─▶ repository ─▶ service ─▶ controller ─▶ route
 *
 * Nothing outside this file allocates a dependency, so swapping one out in a
 * test is a one-line change rather than a refactor.
 */
export function createRootRouter(db: DbHandle, log: Logger) {
  const app = new Hono<AppBindings>();

  const authRepository = createUserRepository({ db: db.db });
  const authService = createAuthService({ repository: authRepository });
  const requireAuth = createRequireAuth(authService);

  const workspaceRepository = createWorkspaceRepository({ db: db.db });

  const mailboxService = createMailboxService({
    db,
    workspaceId: async () => (await workspaceRepository.primary()).id,
  });

  const campaignService = createCampaignService({
    db,
    workspaceId: async () => (await workspaceRepository.primary()).id,
    userId: async () => "00000000-0000-0000-0000-000000000000",
  });

  const leadService = createLeadService({
    db,
    workspaceId: async () => (await workspaceRepository.primary()).id,
  });

  const workspaceId = async () => (await workspaceRepository.primary()).id;

  const inboxService = createInboxService({ db, workspaceId });

  const notificationService = createNotificationService({ db, workspaceId });

  const analyticsService = createAnalyticsService({ db, workspaceId });

  const webhookService = createWebhookService({ db, workspaceId });

  const subsequenceService = createSubsequenceService({ db, workspaceId });

  const publicApiService = createPublicApiService({ db });

  const listService = createListService({ db, workspaceId });

  const alertRecipientsService = createAlertRecipientsService({
    db,
    log,
    workspaceId,
  });

  const settingsService = createSettingsService({
    db,
    llmBaseUrl: env.LLM_BASE_URL,
    llmApiKey: env.LLM_API_KEY,
  });

  const apiKeyAuth = createApiKeyAuth({ webhooks: webhookService });

  /* --------------------------------- ready --------------------------------- */

  /**
   * Readiness probe: reports Postgres and mailcore. Mounted under /api (not
   * /health, which is liveness for the container) so an orchestrator can gate
   * traffic before the app is actually able to serve.
   */
  app.get("/health", async (c) => {
    let database: "ok" | "error" = "error";
    let mailcore: "ok" | "error" | "skipped" = "skipped";

    try {
      await db.ping();
      database = "ok";
    } catch (error) {
      log.error("readiness: cannot reach postgres", { error: String(error) });
    }

    if (env.MAILCORE_API_TOKEN) {
      try {
        const res = await fetch(
          `${env.MAILCORE_API_URL.replace(/\/$/, "")}/v1/accounts`,
          {
            headers: {
              Authorization: `Bearer ${env.MAILCORE_API_TOKEN}`,
            },
          },
        );
        mailcore = res.ok ? "ok" : "error";
      } catch (error) {
        log.warn("readiness: cannot reach mailcore", { error: String(error) });
        mailcore = "error";
      }
    } else {
      mailcore = "skipped";
    }

    const status = database === "ok" && mailcore !== "error" ? "ok" : "error";
    return c.json(
      {
        status,
        version: "0.1.0",
        nodeEnv: env.NODE_ENV,
        checks: { database, mailcore },
      },
      (status === "ok" ? 200 : 503) as 200 | 503,
    );
  });

  /* -------------------------------- routers -------------------------------- */

  app.route(
    "/auth",
    createAuthRoutes(authService, requireAuth, env.SESSION_TTL_DAYS * 86_400),
  );
  app.route("/mailboxes", createMailboxRoutes(mailboxService, requireAuth));
  app.route("/campaigns", createCampaignRoutes(campaignService, requireAuth));
  app.route("/leads", createLeadRoutes(leadService, requireAuth));
  app.route(
    "/workspace",
    createWorkspaceRoutes(workspaceRepository, requireAuth),
  );
  app.route("/inbox", createInboxRoutes(inboxService, requireAuth));
  app.route("/notifications", createNotificationRoutes(notificationService, requireAuth));  app.route(
    "/analytics",
    createAnalyticsRoutes(analyticsService, requireAuth),
  );
  app.route("/webhooks", createWebhookRoutes(webhookService, requireAuth));
  app.route(
    "/subsequences",
    createSubsequenceRoutes(subsequenceService, requireAuth),
  );
  app.route("/settings", createSettingsRoutes(settingsService, requireAuth));
  app.route("/lists", createListRoutes(listService, requireAuth));
  app.route(
    "/alert-recipients",
    createAlertRecipientRoutes(alertRecipientsService, requireAuth),
  );

  /**
   * The public api. Keyed by an api key rather than a session, so another
   * system can read the same numbers the dashboard shows. It is mounted
   * before the session routers because it carries its own auth.
   */
  app.route("/public/v1", createPublicApiRoutes(publicApiService, apiKeyAuth));

  /* --------------------------- built in later phases ----------------------- */

  /**
   * Mounted so the API surface documents itself: a client hitting an unbuilt
   * route gets a structured 501 naming the resource, not a silent 404.
   */
  const pending: Array<[path: string, resource: string]> = [];

  for (const [path, resource] of pending) {
    app.all(`${path}/*`, (_c: AppContext, next) => {
      void next;
      throw notImplemented(resource);
    });
  }

  return app;
}

