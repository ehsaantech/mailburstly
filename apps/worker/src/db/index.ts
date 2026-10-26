import { createDb, type DbHandle } from "@mailrung/db";

export type { DbHandle };

export function getDatabase(url: string, max = 20): DbHandle {
  return createDb(url, { max });
}