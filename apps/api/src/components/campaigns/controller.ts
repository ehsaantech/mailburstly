import { Hono } from "hono";

import { created, noContent, ok, paginated } from "@/core/response";
import { parseJson, parseParams } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { CampaignService } from "./service";
import {
  assignMailboxesSchema,
  attachListSchema,
  campaignParamsSchema,
  createCampaignSchema,
  createStepSchema,
  createVariantSchema,
  enrollLeadsSchema,
  previewStepSchema,
  reorderStepsSchema,
  stepParamsSchema,
  testSendSchema,
  updateCampaignSchema,
  updateStepSchema,
  updateVariantSchema,
  variantParamsSchema,
} from "./validator";

export function createCampaignRoutes(
  campaigns: CampaignService,
  requireAuth: AppMiddleware,
) {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => ok(c, { items: await campaigns.list() }));

  routes.post("/", async (c) => {
    const input = await parseJson(c, createCampaignSchema);
    return created(c, { campaign: await campaigns.create(input) });
  });

  routes.get("/:id", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    return ok(c, { campaign: await campaigns.get(id) });
  });

  routes.patch("/:id", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const patch = await parseJson(c, updateCampaignSchema);
    return ok(c, { campaign: await campaigns.update(id, patch) });
  });

  routes.delete("/:id", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    await campaigns.remove(id);
    return noContent(c);
  });

  routes.post("/:id/launch", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    return ok(c, { campaign: await campaigns.launch(id) });
  });

  routes.post("/:id/pause", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    return ok(c, { campaign: await campaigns.pause(id) });
  });

  routes.post("/:id/resume", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    return ok(c, { campaign: await campaigns.resume(id) });
  });

  // --- Steps ---

  routes.get("/:id/steps", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    return ok(c, { items: await campaigns.listStepsWithVariants(id) });
  });

  // --- Reordering ---

  routes.patch("/:id/steps/reorder", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const input = await parseJson(c, reorderStepsSchema);
    return ok(c, { items: await campaigns.reorderSteps(id, input) });
  });

  // --- Preview and test send ---

  routes.post("/:id/preview", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const input = await parseJson(c, previewStepSchema);
    return ok(c, await campaigns.preview(id, input));
  });

  routes.post("/:id/test-send", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const input = await parseJson(c, testSendSchema);
    return created(c, await campaigns.testSend(id, input));
  });

  routes.post("/:id/steps", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const input = await parseJson(c, createStepSchema);
    return created(c, { step: await campaigns.addStep(id, input) });
  });

  routes.patch("/:id/steps/:stepId", async (c) => {
    const { id, stepId } = parseParams(c, stepParamsSchema);
    const patch = await parseJson(c, updateStepSchema);
    return ok(c, { step: await campaigns.updateStep(id, stepId, patch) });
  });

  routes.delete("/:id/steps/:stepId", async (c) => {
    const { id, stepId } = parseParams(c, stepParamsSchema);
    await campaigns.removeStep(id, stepId);
    return noContent(c);
  });

  // --- Variants ---

  routes.get("/:id/steps/:stepId/variants", async (c) => {
    const { id, stepId } = parseParams(c, stepParamsSchema);
    return ok(c, { items: await campaigns.listVariants(id, stepId) });
  });

  routes.post("/:id/steps/:stepId/variants", async (c) => {
    const { id, stepId } = parseParams(c, stepParamsSchema);
    const input = await parseJson(c, createVariantSchema);
    return created(c, {
      variant: await campaigns.createVariant(id, stepId, input),
    });
  });

  routes.patch("/:id/steps/:stepId/variants/:variantId", async (c) => {
    const { id, stepId, variantId } = parseParams(c, variantParamsSchema);
    const input = await parseJson(c, updateVariantSchema);
    return ok(c, {
      variant: await campaigns.updateVariant(id, stepId, variantId, input),
    });
  });

  routes.delete("/:id/steps/:stepId/variants/:variantId", async (c) => {
    const { id, stepId, variantId } = parseParams(c, variantParamsSchema);
    await campaigns.removeVariant(id, stepId, variantId);
    return noContent(c);
  });

  // --- Mailbox assignment ---

  routes.get("/:id/mailboxes", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    return ok(c, { mailboxIds: await campaigns.listMailboxIds(id) });
  });

  routes.post("/:id/mailboxes", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const input = await parseJson(c, assignMailboxesSchema);
    await campaigns.assignMailboxes(id, input.mailboxIds);
    return ok(c, { mailboxIds: input.mailboxIds });
  });

  // --- Enrollment ---

  routes.post("/:id/leads", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const input = await parseJson(c, enrollLeadsSchema);
    await campaigns.enrollLeads(id, input);
    return ok(c, { enrolled: input.leadIds.length });
  });

  routes.get("/:id/leads", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const limit = Number(c.req.query("limit") ?? 50);
    const offset = Number(c.req.query("offset") ?? 0);
    const [items, total] = await Promise.all([
      campaigns.listCampaignLeads(id, limit, offset),
      campaigns.countCampaignLeads(id),
    ]);
    return paginated(c, items, offset + items.length < total ? String(offset + items.length) : null);
  });

  // --- Attached lists ---

  routes.get("/:id/lists", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    return ok(c, { items: await campaigns.listLists(id) });
  });

  routes.post("/:id/lists", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const input = await parseJson(c, attachListSchema);
    return created(c, await campaigns.attachList(id, input.listId));
  });

  routes.delete("/:id/lists/:listId", async (c) => {
    const { id } = parseParams(c, campaignParamsSchema);
    const listId = c.req.param("listId");
    await campaigns.detachList(id, listId);
    return noContent(c);
  });

  return routes;
}