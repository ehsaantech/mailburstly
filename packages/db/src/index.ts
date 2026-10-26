/**
 * Schema + client, shared by the api and the worker.
 *
 * This package is what stops the two services from drifting apart on column
 * names. Both import from here; neither defines its own schema.
 */

export * from "./schema";
/** Grouped namespace, for cases like `drizzle({ schema: tables })`. */
export * as tables from "./schema";

export { createDb } from "./client";
export type { Database, DbHandle } from "./client";