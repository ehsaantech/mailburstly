import { Queue, Worker } from "bullmq";
import { createRedisConnection, QUEUE_NAMES } from "@/queue/connection";
import type { Logger } from "@/core/logger";

export interface QueueHandle {
  queues: Record<string, Queue>;
  workers: Worker[];
  close: () => Promise<void>;
}

/**
 * Wire up the BullMQ queues and their processors.
 *
 * For now every processor is a no-op that logs and resolves — the actual
 * scheduling, classification, etc. land in M3/M4. The structure is here so
 * the container boots, reports healthy, and can be smoke-tested.
 */
export function createQueueHandle(redisUrl: string, log: Logger): QueueHandle {
  const connection = createRedisConnection(redisUrl);

  const queues: Record<string, Queue> = {};
  for (const name of Object.values(QUEUE_NAMES)) {
    queues[name] = new Queue(name, { connection });
  }

  const workers: Worker[] = [];
  for (const name of Object.values(QUEUE_NAMES)) {
    const worker = new Worker(
      name,
      async (job) => {
        log.debug("job received", { queue: name, jobId: job.id, name: job.name });
        // Real processors are wired in M3/M4.
      },
      { connection, concurrency: 5 },
    );
    worker.on("failed", (job, error) => {
      log.warn("job failed", { queue: name, jobId: job?.id, error: String(error) });
    });
    workers.push(worker);
  }

  return {
    queues,
    workers,
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(Object.values(queues).map((q) => q.close()));
    },
  };
}