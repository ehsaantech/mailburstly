import { getDatabase } from "@/db";
import { createLogger } from "@/core/logger";
import { env } from "@/env";
import { createApp } from "@/app";
import { createQueueHandle } from "@/queue/queues";
import { createSchedulerService } from "@/components/scheduler/service";
import { createEventsService } from "@/components/events/service";
import { createEventsController } from "@/components/events/controller";
import { createWebhookService } from "@/components/webhooks/service";
import { createAggregationService } from "@/components/aggregation/service";
import { createSubsequenceService } from "@/components/subsequences/service";
import { createClassificationService } from "@/components/classification/service";
import { createAutoPauseService } from "@/components/auto-pause/service";
import { createScheduledReplyService } from "@/components/scheduled-replies/service";
import { workspaces } from "@mailrung/db";

const log = createLogger(env.LOG_LEVEL, { service: "worker", env: env.NODE_ENV });

const db = getDatabase(env.DATABASE_URL, 20);

const handle = createQueueHandle(env.REDIS_URL, log);

const scheduler = createSchedulerService({
  db,
  log,
  workspaceId: async () => {
    const rows = await db.db.select().from(workspaces).limit(1);
    return rows[0]?.id ?? "";
  },
});

const webhookService = createWebhookService({ db, log });

const subsequenceService = createSubsequenceService({ db, log });

// The classifier. With no API key the rules answer every reply, so the
// pipeline works exactly as it did before this existed.
const classifier = createClassificationService({
  log,
  apiKey: env.LLM_API_KEY,
  baseUrl: env.LLM_BASE_URL,
  model: env.LLM_MODEL,
  minConfidence: env.LLM_CLASSIFY_MIN_CONFIDENCE,
  timeoutMs: env.LLM_TIMEOUT_MS,
  // The operator picks the model from the dashboard; the worker reads it
  // from the workspace row on every classification.
  resolveSettings: async () => {
    const rows = await db.db.execute(
      "SELECT settings FROM workspaces ORDER BY created_at ASC LIMIT 1",
    );
    const settings = (rows[0] as { settings?: unknown } | undefined)?.settings;
    if (!settings || typeof settings !== "object") return null;
    const llm = (settings as { llm?: unknown }).llm;
    if (!llm || typeof llm !== "object") return null;
    const o = llm as { model?: unknown; minConfidence?: unknown; enabled?: unknown };
    return {
      model: typeof o.model === "string" ? o.model : null,
      minConfidence:
        typeof o.minConfidence === "number" ? o.minConfidence : null,
      enabled: typeof o.enabled === "boolean" ? o.enabled : null,
    };
  },
});

log.info("reply classifier ready", {
  provider: env.LLM_PROVIDER,
  model: env.LLM_MODEL,
  enabled: classifier.enabled,
});

const eventsService = createEventsService({
  db,
  log,
  outbound: webhookService,
  subsequences: subsequenceService,
  classifier,
});
const eventsController = createEventsController({
  service: eventsService,
  log,
  secret: env.EMAILENGINE_SERVICE_SECRET,
});

// Scheduler tick: every SCHEDULER_TICK_MS, compute due steps.
const tickInterval = setInterval(async () => {
  try {
    await scheduler.tick();
  } catch (error) {
    log.error("scheduler tick failed", { error: String(error) });
  }

  await runHousekeeping();
}, env.SCHEDULER_TICK_MS);

// Auto-pause: pause a campaign whose metrics have gone bad.
const autoPause = createAutoPauseService({ db, log });

// Scheduled replies: send the replies the operator queued for later.
const scheduledReplies = createScheduledReplyService({
  db,
  log,
  emailEngine: {
    baseUrl: env.EMAILENGINE_API_URL,
    apiKey: env.EMAILENGINE_API_TOKEN,
  },
});

// Subsequences: send the next step of any follow-up sequence that is due.
const runSubsequences = async () => {
  try {
    await subsequenceService.run();
  } catch (error) {
    log.error("subsequence run failed", { error: String(error) });
  }
};

/**
 * The tick's housekeeping.
 *
 * Auto-pause and scheduled replies run on the scheduler's cadence rather
 * than on their own timers: both are cheap, and one timer is one fewer
 * thing to reason about.
 */
const runHousekeeping = async () => {
  try {
    await autoPause.run();
  } catch (error) {
    log.error("auto-pause run failed", { error: String(error) });
  }

  try {
    await scheduledReplies.run();
  } catch (error) {
    log.error("scheduled replies run failed", { error: String(error) });
  }
};

const subsequenceInterval = setInterval(
  () => void runSubsequences(),
  env.SUBSEQUENCE_TICK_MS,
);

// Aggregation: roll the activity log up into daily statistics. It runs
// once at start-up and then on a timer, because the numbers on the
// dashboard should not need a manual refresh to be right.
const aggregation = createAggregationService({ db, log });

const aggregate = async () => {
  try {
    await aggregation.run();
  } catch (error) {
    log.error("aggregation failed", { error: String(error) });
  }
};

await aggregate();
const aggregateInterval = setInterval(() => void aggregate(), env.AGGREGATION_INTERVAL_MS);

// Run the housekeeping once at start-up so a restart does not leave due
// work waiting for the first tick.
await runHousekeeping();

const app = createApp({
  log,
  health: async () => {
    await db.ping();
    return { status: "ok", checks: { database: "ok", queues: String(handle.workers.length) } };
  },
  webhookHandler: eventsController,
});

const server = Bun.serve({
  port: env.WORKER_PORT,
  fetch: app.fetch,
});

log.info("worker listening", { port: server.port, queues: Object.keys(handle.queues).length });

async function shutdown(signal: string) {
  log.info("shutting down", { signal });
  try {
    clearInterval(tickInterval);
    clearInterval(aggregateInterval);
    clearInterval(subsequenceInterval);
    server.stop(true);
    await handle.close();
    await db.close();
  } catch (error) {
    log.error("shutdown error", { error: String(error) });
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));