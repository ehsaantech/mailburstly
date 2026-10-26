import { Hono } from "hono";

import { created, noContent, ok } from "@/core/response";
import { parseJson, parseParams, parseQuery } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { InboxService } from "./service";
import {
  attachLeadSchema,
  conversationParamsSchema,
  createMacroSchema,
  leadStatusParamsSchema,
  listConversationsQuerySchema,
  listOpportunitiesQuerySchema,
  macroParamsSchema,
  messageParamsSchema,
  opportunityParamsSchema,
  remindSchema,
  replySchema,
  scheduleReplySchema,
  suggestSchema,
  updateConversationSchema,
  updateMacroSchema,
  updateOpportunitySchema,
} from "./validator";

export function createInboxRoutes(inbox: InboxService, requireAuth: AppMiddleware) {
  // NOTE: static segments must be registered before "/:id", otherwise
  // "/opportunities" and "/macros" are captured by the uuid param.
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/conversations", async (c) => {
    const query = parseQuery(c, listConversationsQuerySchema);
    const { items, total } = await inbox.listConversations(query);
    return ok(c, { items, total });
  });

  routes.get("/opportunities", async (c) => {
    const query = parseQuery(c, listOpportunitiesQuerySchema);
    const { items, total } = await inbox.listOpportunities(query);
    return ok(c, { items, total });
  });

  routes.get("/labels", async (c) => {
    return ok(c, { items: await inbox.statusLabels() });
  });

  routes.get("/macros", async (c) => {
    return ok(c, { items: await inbox.listMacros() });
  });

  routes.post("/macros", async (c) => {
    const input = await parseJson(c, createMacroSchema);
    return created(c, { macro: await inbox.createMacro(input) });
  });

  routes.patch("/macros/:id", async (c) => {
    const { id } = parseParams(c, macroParamsSchema);
    const input = await parseJson(c, updateMacroSchema);
    return ok(c, { macro: await inbox.updateMacro(id, input) });
  });

  routes.delete("/macros/:id", async (c) => {
    const { id } = parseParams(c, macroParamsSchema);
    await inbox.removeMacro(id);
    return noContent(c);
  });

  routes.get("/lead-status/:id", async (c) => {
    const { id } = parseParams(c, leadStatusParamsSchema);
    return ok(c, { items: await inbox.leadTimeline(id) });
  });

  routes.get("/messages/:id", async (c) => {
    const { id } = parseParams(c, messageParamsSchema);
    return ok(c, { message: await inbox.getMessage(id) });
  });

  routes.get("/conversations/:id", async (c) => {
    const { id } = parseParams(c, conversationParamsSchema);
    return ok(c, { conversation: await inbox.getConversation(id) });
  });

  routes.patch("/conversations/:id", async (c) => {
    const { id } = parseParams(c, conversationParamsSchema);
    const input = await parseJson(c, updateConversationSchema);
    return ok(c, { conversation: await inbox.updateConversation(id, input) });
  });

  routes.post("/conversations/:id/reply", async (c) => {
    const { id } = parseParams(c, conversationParamsSchema);
    const input = await parseJson(c, replySchema);
    return created(c, await inbox.reply(id, input));
  });

  routes.post("/conversations/:id/schedule", async (c) => {
    const { id } = parseParams(c, conversationParamsSchema);
    const input = await parseJson(c, scheduleReplySchema);
    return created(c, await inbox.scheduleReply(id, input));
  });

  routes.post("/conversations/:id/remind", async (c) => {
    const { id } = parseParams(c, conversationParamsSchema);
    const input = await parseJson(c, remindSchema);
    return ok(c, await inbox.remind(id, input));
  });

  routes.post("/conversations/:id/suggest", async (c) => {
    const { id } = parseParams(c, conversationParamsSchema);
    const input = await parseJson(c, suggestSchema);
    return ok(c, await inbox.suggest(id, input));
  });

  routes.post("/conversations/:id/attach-lead", async (c) => {
    const { id } = parseParams(c, conversationParamsSchema);
    const input = await parseJson(c, attachLeadSchema);
    return ok(c, await inbox.attachLead(id, input));
  });

  routes.patch("/opportunities/:id", async (c) => {
    const { id } = parseParams(c, opportunityParamsSchema);
    const input = await parseJson(c, updateOpportunitySchema);
    return ok(c, { opportunity: await inbox.updateOpportunity(id, input) });
  });

  return routes;
}
