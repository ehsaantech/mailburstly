import { Hono } from "hono";
import type { Context } from "hono";
import type { Logger } from "@/core/logger";

export interface AppBindings { Variables: { requestId: string } }
export type AppContext = Context<AppBindings>;

export function createApp(options: {
  log: Logger;
  health: () => Promise<{ status: "ok" | "error"; checks: Record<string, string> }>;
  webhookHandler: (c: AppContext) => Promise<Response>;
}) {
  const { log, health, webhookHandler } = options;
  const app = new Hono<AppBindings>();

  app.use("*", async (c, next) => {
    const id = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  });

  app.get("/health", async (c) => {
    try {
      const report = await health();
      return c.json(report, (report.status === "ok" ? 200 : 503) as 200 | 503);
    } catch (error) {
      log.error("healthcheck failed", { error: String(error) });
      return c.json({ status: "error", checks: { database: "error" } }, 503);
    }
  });

  app.post("/webhooks/emailengine", webhookHandler);

  return app;
}