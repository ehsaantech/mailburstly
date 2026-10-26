import { createBunRedisClient } from "bullmq";
import { RedisClient } from "bun";

export function createRedisConnection(url: string) {
  const client = new RedisClient(url);
  return createBunRedisClient(client);
}

export const QUEUE_NAMES = {
  SCHEDULER: "scheduler",
  REPLY_INTAKE: "reply-intake",
  CLASSIFICATION: "classification",
  VERIFICATION: "verification",
  WEBHOOK_DELIVERY: "webhook-delivery",
  AGGREGATION: "aggregation",
  RECONCILE: "reconcile",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];