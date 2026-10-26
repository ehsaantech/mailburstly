/**
 * Database bootstrap for the api.
 *
 * The schema and pool live in @mailrung/db so the worker can import the same
 * thing. This file exists only to own the singleton lifecycle and to keep a
 * stable import path (`@/db`) that does not leak the package name everywhere.
 */

import { createDb, type DbHandle } from "@mailrung/db";

export { createDb, tables } from "@mailrung/db";
export type { Database, DbHandle } from "@mailrung/db";

let handle: DbHandle | null = null;

/** Create once, reuse everywhere, close on shutdown. */
export function getDatabase(url: string, options?: { max?: number }): DbHandle {
  handle ??= createDb(url, options);
  return handle;
}

export function closeDatabase(): Promise<void> {
  return handle?.close() ?? Promise.resolve();
}