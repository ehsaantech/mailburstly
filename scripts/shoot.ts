/**
 * Screenshots the inbox and analytics pages with real data in them.
 *
 * Seeds a campaign with activity, a conversation with a lead, and an
 * auto-pause rule, takes the shots, then removes everything it created.
 *
 *   bun run scripts/shoot.ts
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
  /* ----------------------------- seed ----------------------------- */

  const workspace = await sql`SELECT id FROM workspaces LIMIT 1`;
  const workspaceId = workspace[0]!.id as string;

  const campaign = await sql`
    INSERT INTO campaigns (workspace_id, name, status, launched_at)
    VALUES (${workspaceId}, 'Screenshot campaign', 'active', now())
    RETURNING id
  `;
  const campaignId = campaign[0]!.id as string;

  const step = await sql`
    INSERT INTO campaign_steps (campaign_id, position, subject, body_html)
    VALUES (${campaignId}, 1, 'Quick question', '<p>Quick question</p>')
    RETURNING id
  `;
  const stepId = step[0]!.id as string;

  const lead = await sql`
    INSERT INTO leads (workspace_id, email, first_name, last_name, company, title)
    VALUES (${workspaceId}, ${`shot-${stamp}@example.com`}, 'Priya', 'Raman',
            'Northwind Labs', 'Head of Growth')
    RETURNING id
  `;
  const leadId = lead[0]!.id as string;

  await sql`
    INSERT INTO campaign_leads (campaign_id, lead_id, current_step_id, state, next_step_at, last_sent_at)
    VALUES (${campaignId}, ${leadId}, ${stepId}, 'active', now(), now())
  `;

  const mailboxForActivity = await sql`SELECT id FROM mailboxes LIMIT 1`;
  const activityMailboxId = mailboxForActivity[0]!.id as string;

  // Fourteen days of activity, so the chart has a shape.
  for (let day = 13; day >= 0; day--) {
    const sent = 6 + (day % 4);
    for (let i = 0; i < sent; i++) {
      await sql`
        INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
        VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${activityMailboxId}, ${stepId}, 'email_sent', '{}'::jsonb,
                now() - ${`${day} days`}::interval - ${`${i} minutes`}::interval)
      `;
    }
    if (day % 3 === 0) {
      await sql`
        INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
        VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${activityMailboxId}, ${stepId}, 'email_opened', '{}'::jsonb,
                now() - ${`${day} days`}::interval)
      `;
    }
    if (day % 5 === 0) {
      await sql`
        INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
        VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${activityMailboxId}, ${stepId}, 'reply_received', '{}'::jsonb,
                now() - ${`${day} days`}::interval)
      `;
    }
    if (day % 7 === 0) {
      await sql`
        INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
        VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${activityMailboxId}, ${stepId}, 'bounced', '{}'::jsonb,
                now() - ${`${day} days`}::interval)
      `;
    }
  }

  const mailbox = await sql`SELECT id FROM mailboxes LIMIT 1`;
  const mailboxId = mailbox[0]!.id as string;

  // The activity rows carry the mailbox, so the per-mailbox table has
  // something to attribute the sends to.

  const conversation = await sql`
    INSERT INTO conversations (
      workspace_id, mailbox_id, lead_id, campaign_id, contact_email, subject,
      has_reply, has_unread, last_message_at
    )
    VALUES (${workspaceId}, ${mailboxId}, ${leadId}, ${campaignId},
            ${`shot-${stamp}@example.com`}, 'Re: quick question about pricing',
            1, 1, now())
    RETURNING id
  `;
  const conversationId = conversation[0]!.id as string;

  await sql`
    INSERT INTO messages (
      workspace_id, conversation_id, mailbox_id, lead_id, campaign_id,
      direction, from_address, to_address, subject, text_body, html_body,
      snippet, classification, is_auto_reply, is_out_of_office, is_unsubscribe, received_at
    )
    VALUES
      (${workspaceId}, ${conversationId}, ${mailboxId}, ${leadId}, ${campaignId},
       'inbound', ${`shot-${stamp}@example.com`}, 'aitchkhan@gmail.com',
       'Re: quick question about pricing',
       'Hi,\n\nThat sounds interesting. Could you send me pricing for 50 seats?\n\nPriya',
       '<p>Hi,</p><p>That sounds interesting. Could you send me pricing for 50 seats?</p>',
       'That sounds interesting. Could you send me pricing for 50 seats?',
       'positive', 0, 0, 0, now() - interval '2 hours'),
      (${workspaceId}, ${conversationId}, ${mailboxId}, ${leadId}, ${campaignId},
       'inbound', ${`shot-${stamp}@example.com`}, 'aitchkhan@gmail.com',
       'Out of Office: away until next week',
       'I am currently out of the office and will return on 2030-02-01.',
       '<p>I am currently out of the office.</p>',
       'I am currently out of the office and will return on 2030-02-01.',
       'out_of_office', 1, 1, 0, now() - interval '1 day')
  `;

  await sql`
    INSERT INTO opportunities (workspace_id, lead_id, conversation_id, campaign_id, title, summary)
    VALUES (${workspaceId}, ${leadId}, ${conversationId}, ${campaignId},
            'Pricing for 50 seats',
            'Asked for pricing for 50 seats and what the onboarding looks like.')
  `;

  await sql`
    INSERT INTO auto_pause_rules (workspace_id, campaign_id, metric, threshold, direction, action, enabled)
    VALUES (${workspaceId}, ${campaignId}, 'bounce_rate', 5, 'above', 'pause_campaign', 1)
  `;

  await sql`
    INSERT INTO auto_pause_rules (workspace_id, campaign_id, metric, threshold, direction, action, enabled)
    VALUES (${workspaceId}, NULL, 'mailbox_health', 40, 'below', 'pause_campaign', 1)
  `;

  /* ------------------------- roll the data up ----------------------- */

  // The chart reads the daily rollup, which the worker computes. A restart
  // triggers it at start-up, so the screenshot shows the real thing.
  await Bun.$`docker compose restart worker`.quiet();
  await new Promise((r) => setTimeout(r, 12_000));

  /* --------------------------- screenshots -------------------------- */

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
    ["/inbox", "inbox"],
    ["/analytics", "analytics"],
  ] as const) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/shot-${name}.png`, fullPage: true });
    console.log(`shot: ${OUT}/shot-${name}.png`);
  }

  await browser.close();

  /* ----------------------------- cleanup ---------------------------- */

  await sql`DELETE FROM activities WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM opportunities WHERE conversation_id = ${conversationId}`;
  await sql`DELETE FROM messages WHERE conversation_id = ${conversationId}`;
  await sql`DELETE FROM conversations WHERE id = ${conversationId}`;
  await sql`DELETE FROM auto_pause_rules WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM auto_pause_rules WHERE campaign_id IS NULL AND metric = 'mailbox_health' AND threshold = 40`;
  await sql`DELETE FROM campaign_leads WHERE lead_id = ${leadId}`;
  await sql`DELETE FROM campaign_steps WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
  await sql`DELETE FROM leads WHERE id = ${leadId}`;

  console.log("cleaned up");
  await sql.end();
}

await main();
