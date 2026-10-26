/**
 * Seed the workspace and the bootstrap admin.
 *
 * Run with:  bun run db:seed     (from packages/db)
 *
 * Idempotent: inserts each row only if absent, and upgrades an existing
 * admin's role if it had drifted, so it is safe on every deploy.
 *
 * Reads process.env — pass ADMIN_EMAIL / ADMIN_PASSWORD to override.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import { workspaces, users, leadLabels } from "./schema";
import { DEFAULT_WORKSPACE_SETTINGS } from "@mailrung/shared";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://mailrung:change-me-postgres@localhost:5432/mailrung";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@example.com")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-admin-password";
const ADMIN_NAME = process.env.ADMIN_NAME ?? "Admin";
const WORKSPACE_NAME = process.env.WORKSPACE_NAME ?? "Mailrung";
const WORKSPACE_TIMEZONE = process.env.WORKSPACE_TIMEZONE ?? "UTC";

const sql = postgres(DATABASE_URL, {
  idle_timeout: 5,
  max_lifetime: 300,
  onnotice: () => {},
});

const db = drizzle(sql, { schema: { workspaces, users } });

try {
  /* Workspace: exactly one, matched on name so re-seeding is a no-op. */
  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.name, WORKSPACE_NAME))
    .limit(1);

  let workspaceId: string;

  if (existing) {
    workspaceId = existing.id;
    console.log(`workspace "${WORKSPACE_NAME}" already exists (${existing.id})`);
  } else {
    const [created] = await db
      .insert(workspaces)
      .values({
        name: WORKSPACE_NAME,
        timezone: WORKSPACE_TIMEZONE,
        settings: DEFAULT_WORKSPACE_SETTINGS,
      })
      .returning({ id: workspaces.id });
    if (!created) throw new Error("workspace insert returned no row");
    workspaceId = created.id;
    console.log(`created workspace "${WORKSPACE_NAME}" (${created.id})`);
  }

  /* Built-in lead statuses. These define the pipeline every lead starts in. */
  const builtinLabels: Array<{
    name: string;
    description: string;
    interest: "positive" | "neutral" | "negative";
  }> = [
    { name: "Interested", description: "The lead has expressed interest or asked for more information.", interest: "positive" },
    { name: "Meeting Booked", description: "A call or meeting has been confirmed on the calendar.", interest: "positive" },
    { name: "Meeting Completed", description: "The booked meeting has taken place but the deal is still open.", interest: "positive" },
    { name: "Won", description: "The lead has become a paying customer.", interest: "positive" },
    { name: "Not Interested", description: "The lead has explicitly declined.", interest: "negative" },
    { name: "Wrong Person", description: "The contact is not the right person for this offer.", interest: "negative" },
    { name: "Out of Office", description: "An automatic reply saying the person is away, usually with a return date.", interest: "neutral" },
    { name: "No Show", description: "The lead did not attend a booked meeting.", interest: "negative" },
    { name: "Lost", description: "The opportunity was closed without a sale.", interest: "negative" },
  ];

  for (const label of builtinLabels) {
    await db
      .insert(leadLabels)
      .values({
        workspaceId,
        name: label.name,
        description: label.description,
        interest: label.interest,
        isBuiltin: 1,
        useAi: 1,
      })
      .onConflictDoNothing();
  }
  console.log(`seeded ${builtinLabels.length} built-in lead statuses`);

  /* Admin: idempotent on email; upgrade the role if it had drifted. */
  const [existingAdmin] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

  if (existingAdmin) {
    console.log(`admin "${ADMIN_EMAIL}" already exists (${existingAdmin.id})`);
    if (existingAdmin.role !== "admin") {
      await db
        .update(users)
        .set({ role: "admin" })
        .where(eq(users.id, existingAdmin.id));
      console.log(`  upgraded role ${existingAdmin.role} -> admin`);
    }
  } else {
    const passwordHash = await Bun.password.hash(ADMIN_PASSWORD, {
      algorithm: "argon2id",
      memoryCost: 19_456,
      timeCost: 2,
    });
    const [created] = await db
      .insert(users)
      .values({
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        role: "admin",
        passwordHash,
      })
      .returning({ id: users.id });
    if (!created) throw new Error("admin insert returned no row");
    console.log(`created admin "${ADMIN_EMAIL}" (${created.id})`);
  }

  console.log("\nseed complete");
  console.log(`  workspace: ${workspaceId}`);
  console.log(`  admin:     ${ADMIN_EMAIL}`);
} catch (error) {
  console.error("seed failed");
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}