import { Hono } from "hono";

import { created, noContent, ok } from "@/core/response";
import { parseJson, parseParams, parseQuery } from "@/core/validate";
import type { AppBindings, AppMiddleware } from "@/types";
import type { SubsequenceService } from "./service";
import {
  createSubsequenceSchema,
  createSubsequenceStepSchema,
  enrollLeadSchema,
  listSubsequencesQuerySchema,
  subsequenceParamsSchema,
  subsequenceStepParamsSchema,
  updateSubsequenceSchema,
  updateSubsequenceStepSchema,
} from "./validator";

export function createSubsequenceRoutes(
  subsequences: SubsequenceService,
  requireAuth: AppMiddleware,
) {
  // NOTE: static segments must be registered before "/:id".
  const routes = new Hono<AppBindings>();
  routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    const query = parseQuery(c, listSubsequencesQuerySchema);
    return ok(c, { items: await subsequences.list(query) });
  });

  routes.post("/", async (c) => {
    const input = await parseJson(c, createSubsequenceSchema);
    return created(c, { subsequence: await subsequences.create(input) });
  });

  routes.get("/:id", async (c) => {
    const { id } = parseParams(c, subsequenceParamsSchema);
    return ok(c, { subsequence: await subsequences.get(id) });
  });

  routes.patch("/:id", async (c) => {
    const { id } = parseParams(c, subsequenceParamsSchema);
    const input = await parseJson(c, updateSubsequenceSchema);
    return ok(c, { subsequence: await subsequences.update(id, input) });
  });

  routes.delete("/:id", async (c) => {
    const { id } = parseParams(c, subsequenceParamsSchema);
    await subsequences.remove(id);
    return noContent(c);
  });

  routes.post("/:id/steps", async (c) => {
    const { id } = parseParams(c, subsequenceParamsSchema);
    const input = await parseJson(c, createSubsequenceStepSchema);
    return created(c, { step: await subsequences.addStep(id, input) });
  });

  routes.patch("/:id/steps/:stepId", async (c) => {
    const { id, stepId } = parseParams(c, subsequenceStepParamsSchema);
    const input = await parseJson(c, updateSubsequenceStepSchema);
    return ok(c, { step: await subsequences.updateStep(id, stepId, input) });
  });

  routes.delete("/:id/steps/:stepId", async (c) => {
    const { id, stepId } = parseParams(c, subsequenceStepParamsSchema);
    await subsequences.removeStep(id, stepId);
    return noContent(c);
  });

  routes.get("/:id/enrollments", async (c) => {
    const { id } = parseParams(c, subsequenceParamsSchema);
    return ok(c, { items: await subsequences.enrollments(id) });
  });

  routes.post("/:id/enroll", async (c) => {
    const { id } = parseParams(c, subsequenceParamsSchema);
    const input = await parseJson(c, enrollLeadSchema);
    return created(c, { enrollment: await subsequences.enroll(id, input) });
  });

  return routes;
}
