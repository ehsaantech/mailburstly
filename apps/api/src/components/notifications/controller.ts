import { Hono } from "hono";
import { ok } from "@/core/response";
import type { AppBindings, AppMiddleware } from "@/types";
import { createNotificationService } from "./service";

type NotificationService = ReturnType<typeof createNotificationService>;

export function createNotificationRoutes(service: NotificationService, requireAuth: AppMiddleware) {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    const user = c.get("user");
    const unreadOnly = c.req.query("unreadOnly") === "true";
    const limit = Number(c.req.query("limit") ?? 30);
    const offset = Number(c.req.query("offset") ?? 0);
    return ok(c, { items: await service.list(user.id, { unreadOnly, limit, offset }) });
  });

  routes.get("/unread-count", async (c) => {
    const user = c.get("user");
    return ok(c, { count: await service.unreadCount(user.id) });
  });

  routes.post("/:id/read", async (c) => {
    const user = c.get("user");
    await service.markRead(user.id, c.req.param("id"));
    return ok(c, { ok: true });
  });

  routes.post("/read-all", async (c) => {
    const user = c.get("user");
    await service.markAllRead(user.id);
    return ok(c, { ok: true });
  });

  return routes;
}
