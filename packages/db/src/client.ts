import { createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  sql: postgres.Sql;
  db: Database;
  /** Ping for /health. Runs a trivial query so a broken pool is detected. */
  ping: () => Promise<void>;
  /** Close the pool, draining in-flight queries. */
  close: () => Promise<void>;
  /** Stable, non-reversible id for logs — never logs credentials. */
  digest: string;
}

/**
 * Create the Postgres handle.
 *
 * Driver choice is deliberate — see architecture.md §6. `drizzle-orm/bun-sql`
 * has open correctness bugs (oven-sh/bun#30494: the prepared-statement cache
 * can serve the wrong statement and silently return wrong rows, and #30010:
 * a connection-wrapper leak). `postgres-js` is the substitute the bug
 * reporter validated under a real workload, so that is what we use.
 */
export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 20,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    prepare: true,
    /* Notices are noise at this level. */
    onnotice: () => {},
  });

  const db = drizzle(sql, { schema });

  const digest = `pg:${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;

  return {
    sql,
    db,
    ping: async () => {
      await sql`select 1`;
    },
    close: async () => {
      await sql.end({ timeout: 5 });
    },
    digest,
  };
}