import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://mailrung:change-me-postgres@localhost:5433/mailrung";

const sql = postgres(DATABASE_URL, {
  idle_timeout: 5,
  max_lifetime: 300,
  onnotice: (notice) => console.log(`notice: ${notice.message}`),
});
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed");
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}