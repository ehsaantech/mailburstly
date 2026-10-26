import type { Next } from "hono";
import { randomUUID } from "node:crypto";

import type { AppContext } from "@/types";

/**
 * Attach a stable request id, honouring an upstream `x-request-id` from the
 * proxy, and echo it back so the browser can correlate a bad response with the
 * server log line.
 */
export async function requestId(c: AppContext, next: Next) {
  const incoming = c.req.header("x-request-id");
  const id = incoming ?? `req_${randomUUID()}`;

  c.set("requestId", id);
  c.header("x-request-id", id);

  await next();
}