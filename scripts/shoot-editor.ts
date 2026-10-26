/**
 * Screenshots the sequence editor and the dashboard with real data.
 *
 *   bun run scripts/shoot-editor.ts
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

  const campaign = await sql`
    INSERT INTO campaigns (workspace_id, name, status, launched_at)
    VALUES (${workspaceId}, ${`Editor shot ${stamp}`}, 'draft', now())
    RETURNING id
  `;
  const campaignId = campaign[0]!.id as string;

  await sql`
    INSERT INTO campaign_steps (campaign_id, position, subject, body_html, delay_minutes, thread_mode)
    VALUES
      (${campaignId}, 1, 'Quick question about {{company}}',
       '<p>Hi {{first_name}},</p><p>I noticed {{company}} is scaling {{industry}}. {Quick question|Sounds interesting} — worth 15 minutes?</p>',
       0, 'reply'),
      (${campaignId}, 2, 'Just following up',
       '<p>Hi {{first_name}}, did my last email reach you?</p>',
       4320, 'reply')
  `;

  const step = await sql`
    SELECT id FROM campaign_steps WHERE campaign_id = ${campaignId} AND position = 1
  `;

  await sql`
    INSERT INTO step_variants (step_id, label, subject, body_html, weight, pinned)
    VALUES (${step[0]!.id}, 'A', 'Quick question about {{company}}',
            '<p>Hi {{first_name}}, quick question about {{company}}.</p>', 60, 0)
  `;

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

  for (const [route, name] of [
    ["/", "dashboard"],
    [`/campaigns/${campaignId}`, "sequence-editor"],
  ] as const) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/shot-${name}.png`, fullPage: true });
    console.log(`shot: ${OUT}/shot-${name}.png`);
  }

  await browser.close();

  await sql`DELETE FROM step_variants WHERE step_id = ${step[0]!.id}`;
  await sql`DELETE FROM campaign_steps WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;

  console.log("cleaned up");
  await sql.end();
}

await main();
