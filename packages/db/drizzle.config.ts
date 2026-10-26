import { defineConfig } from "drizzle-kit";

/**
 * IMPORTANT: run drizzle-kit with Node, not Bun.
 *
 * `bun --bun drizzle-kit push` has a known bug (oven-sh/bun#8545) where the
 * schema module's exports read as empty and the tool drops the database.
 * The package script uses the plain `drizzle-kit` binary for that reason.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://mailrung:change-me-postgres@localhost:5432/mailrung",
  },
  strict: true,
  verbose: true,
});
