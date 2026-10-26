/**
 * Screenshots the lists page with a real list in it.
 *
 *   bun run scripts/shoot-lists.ts
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const OUT = process.env.OUT_DIR ?? "/tmp/shots";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://mailrung:change-me-postgres@localhost:5433/mailrung";

const { default: postgres } = await import(
  "../packages/db/node_modules/postgres/src/index.js"
);

const sql = postgres(databaseUrl, { max: 1 });

const stamp = Date.now();

async function main() {
  const workspace = await sql`SELECT id FROM workspaces LIMIT 1`;
  const workspaceId = workspace[0]!.id as string;

  const list = await sql`
    INSERT INTO lead_lists (workspace_id, name, description)
    VALUES (${workspaceId}, ${`SaaS founders — US, 20–200 employees ${stamp}`},
            'Inbound from the webinar in October. Verified against their website.')
    RETURNING id
  `;
  const listId = list[0]!.id as string;

  const leads = await sql`
    INSERT INTO leads (workspace_id, email, first_name, last_name, company, title)
    VALUES
      (${workspaceId}, ${`shot-a-${stamp}@example.com`}, 'Priya', 'Raman', 'Northwind Labs', 'Head of Growth'),
      (${workspaceId}, ${`shot-b-${stamp}@example.com`}, 'Marcus', 'Weber', 'Lumen Systems', 'CTO'),
      (${workspaceId}, ${`shot-c-${stamp}@example.com`}, 'Ana', 'Duarte', 'Fathom Data', 'VP Sales')
    RETURNING id
  `;

  for (const lead of leads) {
    await sql`
      INSERT INTO lead_list_members (list_id, lead_id)
      VALUES (${listId}, ${(lead as any).id})
    `;
  }

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });

  await context.addInitScript(() => {
    try {
      localStorage.setItem("mailrung.theme", "dark");
    } catch {
      /* ignore */
    }
  });

  const page = await context.newPage();
  await page.request.post(BASE + "/api/auth/login", {
    data: {
      email: process.env.ADMIN_EMAIL ?? "admin@example.com",
      password: process.env.ADMIN_PASSWORD ?? "change-me-admin-password",
    },
  });

  await page.goto(BASE + "/lists", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/shot-lists.png`, fullPage: true });
  console.log(`shot: ${OUT}/shot-lists.png`);

  // And the list itself, open.
  await page.getByText("SaaS founders", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/shot-list-detail.png`, fullPage: true });
  console.log(`shot: ${OUT}/shot-list-detail.png`);

  await browser.close();

  await sql`DELETE FROM lead_list_members WHERE list_id = ${listId}`;
  await sql`DELETE FROM lead_lists WHERE id = ${listId}`;
  await sql`DELETE FROM leads WHERE id IN ${sql(leads.map((l: any) => l.id))}`;

  console.log("cleaned up");
  await sql.end();
}

await main();
