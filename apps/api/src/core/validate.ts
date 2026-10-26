import type { Context } from "hono";
import type { z } from "zod";

import { badRequest } from "./errors";

/**
 * Request validation.
 *
 * Hono's zod-validator works but hides the error shape, and this api wants a
 * single error envelope with per-field details. So validation is explicit:
 * call `parseJson(c, Schema)` at the top of a handler.
 */

type FieldErrors = Record<string, string[]>;

function flatten(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join(".") : "_root";
    (out[field] ??= []).push(issue.message);
  }
  return out;
}

/** Parse and validate the JSON body. Throws a 400 with field details on failure. */
export async function parseJson<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest("Validation failed", flatten(result.error));
  }
  return result.data;
}

/** Validate the query string against a schema. */
export function parseQuery<S extends z.ZodType>(
  c: Context,
  schema: S,
): z.infer<S> {
  const result = schema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!result.success) {
    throw badRequest("Invalid query parameters", flatten(result.error));
  }
  return result.data;
}

/** Validate a path parameter against a schema. */
export function parseParams<S extends z.ZodType>(
  c: Context,
  schema: S,
): z.infer<S> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) {
    throw badRequest("Invalid path parameters", flatten(result.error));
  }
  return result.data;
}