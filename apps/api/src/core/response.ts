import type { Context } from "hono";

import type { PaginatedResponse } from "@mailrung/shared";

/**
 * Response helpers.
 *
 * Successes always wrap their payload in `data`. Errors always wrap theirs in
 * `error`. A consumer therefore never inspects a status code to decide how to
 * read the body.
 */

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ data }, status as 200 | 201);
}

export function created<T>(c: Context, data: T) {
  return ok(c, data, 201);
}

export function noContent(c: Context) {
  return c.body(null, 204);
}

export function paginated<T>(
  c: Context,
  items: T[],
  nextCursor: string | null,
) {
  const body: PaginatedResponse<T> = {
    data: items,
    page: { nextCursor },
  };
  return c.json(body);
}