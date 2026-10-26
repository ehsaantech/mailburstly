/**
 * Verifies the M5 analytics surface: the campaign funnel, the activity log
 * with its filters, the per-mailbox metrics, the diagnosis, and the numbers
 * the campaigns list now shows.
 *
 *   bun run scripts/verify-m5.ts
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-admin-password";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://mailrung:change-me-postgres@localhost:5433/mailrung";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    if (detail !== undefined) {
      console.log(`       ${JSON.stringify(detail).slice(0, 300)}`);
    }
  }
}

const { default: postgres } = await import(
  "../packages/db/node_modules/postgres/src/index.js"
);

const sql = postgres(databaseUrl, { max: 1 });

let cookie = "";

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function main() {
  console.log("\n1. sign in");
  {
    const res = await call("POST", "/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    check("login succeeds", res.status === 200, res.status);
  }

  const stamp = Date.now();

  /* ----------------------------- the data ----------------------------- */

  console.log("\n2. seed a campaign with activity");

  const workspace = await sql`SELECT id FROM workspaces LIMIT 1`;
  const workspaceId = workspace[0]!.id as string;

  const campaign = await sql`
    INSERT INTO campaigns (workspace_id, name, status, launched_at, schedule, daily_limit)
    VALUES (${workspaceId}, ${`M5 verify ${stamp}`}, 'active', now(),
            '{"mode":"always","rules":[]}'::jsonb, 100)
    RETURNING id
  `;
  const campaignId = campaign[0]!.id as string;

  // A separate, draft campaign owns the step. The test campaign has no
  // steps of its own, so the scheduler never creates a send job for it —
  // even though it is active and enrolled, there is nothing to send. The
  // step is only needed so the activity rows have a valid foreign key.
  const fixtureCampaign = await sql`
    INSERT INTO campaigns (workspace_id, name, status)
    VALUES (${workspaceId}, 'M5 fixture', 'draft')
    RETURNING id
  `;
  const fixtureCampaignId = fixtureCampaign[0]!.id as string;

  const step = await sql`
    INSERT INTO campaign_steps (campaign_id, position, subject, body_html)
    VALUES (${fixtureCampaignId}, 1, 'Step one', '<p>Step one</p>')
    RETURNING id
  `;
  const stepId = step[0]!.id as string;

  const lead = await sql`
    INSERT INTO leads (workspace_id, email, first_name, last_name, company)
    VALUES (${workspaceId}, ${`m5-${stamp}@example.com`}, 'Priya', 'Raman', 'Northwind')
    RETURNING id
  `;
  const leadId = lead[0]!.id as string;

  // Mark the lead positive so the positive-reply count is not zero.
  await sql`
    UPDATE leads SET status_id = (
      SELECT id FROM lead_labels WHERE name = 'Interested' LIMIT 1
    ) WHERE id = ${leadId}
  `;

  await sql`
    INSERT INTO campaign_leads (campaign_id, lead_id, current_step_id, state, next_step_at, last_sent_at)
    VALUES (${campaignId}, ${leadId}, ${stepId}, 'active', now(), now())
  `;

  const mailbox = await sql`SELECT id FROM mailboxes LIMIT 1`;
  const mailboxId = mailbox[0]!.id as string;

  // 10 sends, 2 opens, 1 reply, 1 auto-reply, 2 bounces, 1 unsubscribe.
  for (let i = 0; i < 10; i++) {
    await sql`
      INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
      VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${mailboxId}, ${stepId},
              'email_sent', '{}'::jsonb, now() - interval '2 days')
    `;
  }
  for (const type of ["email_opened", "reply_received"]) {
    await sql`
      INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
      VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${mailboxId}, ${stepId},
              ${type}, '{}'::jsonb, now() - interval '2 days')
    `;
  }
  await sql`
    INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
    VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${mailboxId}, ${stepId},
            'auto_reply', '{}'::jsonb, now() - interval '2 days')
  `;
  for (let i = 0; i < 2; i++) {
    await sql`
      INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
      VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${mailboxId}, ${stepId},
              'bounced', '{}'::jsonb, now() - interval '2 days')
    `;
  }
  await sql`
    INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
    VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${mailboxId}, ${stepId},
            'unsubscribed', '{}'::jsonb, now() - interval '2 days')
  `;

  await sql`
    INSERT INTO opportunities (workspace_id, lead_id, campaign_id, title, summary, value)
    VALUES (${workspaceId}, ${leadId}, ${campaignId}, 'Pricing', 'Asked for pricing', 5000)
  `;

  // One event dated today, so the daily limit has something to count.
  await sql`
    INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, type, meta, created_at)
    VALUES (${workspaceId}, ${campaignId}, ${leadId}, ${mailboxId}, ${stepId},
            'email_sent', '{}'::jsonb, now())
  `;

  // A rule, so the paused-by-rule diagnosis has something to point at.
  const rule = await sql`
    INSERT INTO auto_pause_rules (workspace_id, campaign_id, metric, threshold, direction, action, enabled)
    VALUES (${workspaceId}, ${campaignId}, 'bounce_rate', 5, 'above', 'pause_campaign', 1)
    RETURNING id
  `;
  const ruleId = rule[0]!.id as string;

  /* ------------------------------ funnel ------------------------------ */

  console.log("\n3. the campaign funnel");

  {
    const res = await call(
      "GET",
      `/analytics/funnels/${campaignId}?from=2000-01-01&to=2100-01-01`,
    );
    check("the funnel loads", res.status === 200, res.status);

    const f = res.json?.data?.funnel;
    check("sent counts the emails", f?.sent === 11, f?.sent);
    check("contacted counts the leads", f?.contacted === 1, f?.contacted);
    check("opened counts the leads", f?.opened === 1, f?.opened);
    check("replied counts the human replies", f?.replied === 1, f?.replied);
    check("auto replies are counted apart", f?.autoReplied === 1, f?.autoReplied);
    check(
      "unique replies count each lead once",
      f?.uniqueReplies === 2,
      f?.uniqueReplies,
    );
    check(
      "positive replies come from the lead's status",
      f?.positiveReplies === 1,
      f?.positiveReplies,
    );
    check("opportunities are counted", f?.opportunities === 1, f?.opportunities);
    check(
      "opportunity value is summed",
      f?.opportunityValue === 5000,
      f?.opportunityValue,
    );
    check("bounces are counted", f?.bounced === 2, f?.bounced);
    check("unsubscribes are counted", f?.unsubscribed === 1, f?.unsubscribed);

    const rates = res.json?.data?.rates;
    check(
      "the reply rate is over sends",
      Math.abs((rates?.replyRate ?? 0) - 1 / 11) < 0.001,
      rates?.replyRate,
    );
    check(
      "the complaint rate is over sends",
      Math.abs((rates?.complaintRate ?? 0) - 1 / 11) < 0.001,
      rates?.complaintRate,
    );
  }

  {
    const res = await call(
      "GET",
      `/analytics/funnels/${campaignId}?from=2000-01-01&to=2100-01-01`,
    );
    check("the funnel is stable across calls", res.status === 200, res.status);
  }

  /* --------------------------- activity log --------------------------- */

  console.log("\n4. the activity log");

  {
    const res = await call(
      "GET",
      "/analytics/activity?from=2000-01-01&to=2100-01-01&limit=100",
    );
    check("the activity log loads", res.status === 200, res.status);
    const items = res.json?.data?.items ?? [];
    check("it has events", items.length > 0, items.length);
    check(
      "the rows carry their campaign name",
      items.some((r: any) => r.campaignName?.includes("M5 verify")),
      items.map((r: any) => r.campaignName).slice(0, 3),
    );
    check(
      "the rows carry their lead address",
      items.some((r: any) => r.leadEmail?.includes(`m5-${stamp}`)),
      items.map((r: any) => r.leadEmail).slice(0, 3),
    );
    check(
      "the rows carry their step subject",
      items.some((r: any) => r.stepSubject === "Step one"),
      items.map((r: any) => r.stepSubject).slice(0, 3),
    );
  }

  {
    const res = await call(
      "GET",
      "/analytics/activity?from=2000-01-01&to=2100-01-01&type=bounced",
    );
    const items = res.json?.data?.items ?? [];
    check("the type filter works", items.length === 2, items.length);
    check(
      "only the filtered type comes back",
      items.every((r: any) => r.activity.type === "bounced"),
      items[0]?.activity.type,
    );
  }

  {
    const res = await call(
      "GET",
      `/analytics/activity?from=2000-01-01&to=2100-01-01&campaignId=${campaignId}`,
    );
    const items = res.json?.data?.items ?? [];
    // 10 sends, 1 open, 1 reply, 1 auto-reply, 2 bounces, 1 unsubscribe
    // and one more send dated today.
    check("the campaign filter works", items.length === 17, items.length);
  }

  {
    const all = await call(
      "GET",
      "/analytics/activity?from=2000-01-01&to=2100-01-01&limit=200",
    );
    const allCount = (all.json?.data?.items ?? []).length;

    const res = await call(
      "GET",
      `/analytics/activity?from=2000-01-01&to=2100-01-01&mailboxId=${mailboxId}&limit=200`,
    );
    const items = res.json?.data?.items ?? [];
    check("the mailbox filter loads", res.status === 200, res.status);
    check(
      "the mailbox filter narrows the list",
      items.length > 0 && items.length <= allCount,
      { filtered: items.length, all: allCount },
    );
    check(
      "every filtered row uses that mailbox",
      items.every((r: any) => r.activity.mailboxId === mailboxId),
      items[0]?.activity?.mailboxId,
    );
  }

  {
    const res = await call(
      "GET",
      "/analytics/activity?from=2000-01-01&to=2100-01-01&type=nonsense",
    );
    check("an unknown type is a 400", res.status === 400, res.status);
  }

  /* --------------------------- mailboxes ------------------------------ */

  console.log("\n5. the per-mailbox metrics");

  {
    const res = await call(
      "GET",
      "/analytics/mailboxes?from=2000-01-01&to=2100-01-01",
    );
    check("the mailbox metrics load", res.status === 200, res.status);

    const items = res.json?.data?.items ?? [];
    const ours = items.find((m: any) => m.mailboxId === mailboxId);
    check("our mailbox is listed", Boolean(ours), items.map((m: any) => m.mailboxId));

    // The mailbox metric counts every event on that mailbox, including the
    // ones earlier runs left behind, so the expectation is read from the
    // database rather than hard-coded.
    const expected = await sql`
      SELECT
        count(*) FILTER (WHERE type = 'email_sent')::int AS sent,
        count(DISTINCT lead_id) FILTER (WHERE type = 'reply_received')::int AS replied,
        count(*) FILTER (WHERE type = 'bounced')::int AS bounced
      FROM activities
      WHERE mailbox_id = ${mailboxId}
    `;

    check(
      "it counts the sends",
      ours?.sent === expected[0]!.sent,
      { got: ours?.sent, expected: expected[0]!.sent },
    );
    check(
      "it counts the replies",
      ours?.replied === expected[0]!.replied,
      { got: ours?.replied, expected: expected[0]!.replied },
    );
    check(
      "it counts the bounces",
      ours?.bounced === expected[0]!.bounced,
      { got: ours?.bounced, expected: expected[0]!.bounced },
    );
    check(
      "it has a score between 0 and 100",
      typeof ours?.score === "number" && ours.score >= 0 && ours.score <= 100,
      ours?.score,
    );
  }

  {
    // A mailbox with no activity in the window must still appear, with
    // zeroes — a left join, not an inner one.
    const res = await call(
      "GET",
      "/analytics/mailboxes?from=1990-01-01&to=1990-12-31",
    );
    const items = res.json?.data?.items ?? [];
    const ours = items.find((m: any) => m.mailboxId === mailboxId);
    check("a mailbox with no activity is still listed", Boolean(ours));
    check("its counters are zero", ours?.sent === 0, ours?.sent);
  }

  /* ----------------------------- diagnose ------------------------------ */

  console.log("\n6. the diagnosis");

  {
    const res = await call("GET", `/analytics/diagnose/${campaignId}`);
    check("the diagnosis loads", res.status === 200, res.status);
    check(
      "a running campaign is diagnosed as sending",
      res.json?.data?.diagnosis?.reason === "sending",
      res.json?.data?.diagnosis,
    );
  }

  {
    // A draft campaign is not "out of schedule" — it has not launched.
    await sql`UPDATE campaigns SET status = 'draft' WHERE id = ${campaignId}`;
    const res = await call("GET", `/analytics/diagnose/${campaignId}`);
    check(
      "a draft campaign is diagnosed as a draft",
      res.json?.data?.diagnosis?.reason === "campaign_draft",
      res.json?.data?.diagnosis,
    );
    await sql`UPDATE campaigns SET status = 'active' WHERE id = ${campaignId}`;
  }

  {
    // A campaign outside its window is diagnosed as out of schedule.
    await sql`
      UPDATE campaigns
      SET schedule = '{"mode":"custom","rules":[{"daysOfWeek":[],"startTime":"09:00","endTime":"17:00","timezone":"UTC"}]}'::jsonb
      WHERE id = ${campaignId}
    `;
    const res = await call("GET", `/analytics/diagnose/${campaignId}`);
    check(
      "a closed window is diagnosed as out of schedule",
      res.json?.data?.diagnosis?.reason === "out_of_schedule",
      res.json?.data?.diagnosis,
    );
    await sql`
      UPDATE campaigns SET schedule = '{"mode":"always","rules":[]}'::jsonb
      WHERE id = ${campaignId}
    `;
  }

  {
    // A daily limit that is already met.
    await sql`UPDATE campaigns SET daily_limit = 1 WHERE id = ${campaignId}`;
    const res = await call("GET", `/analytics/diagnose/${campaignId}`);
    check(
      "a met daily limit is diagnosed as such",
      res.json?.data?.diagnosis?.reason === "daily_limit_met",
      res.json?.data?.diagnosis,
    );
    await sql`UPDATE campaigns SET daily_limit = 100 WHERE id = ${campaignId}`;
  }

  {
    // A paused campaign that an auto-pause rule stopped.
    await sql`UPDATE campaigns SET status = 'paused' WHERE id = ${campaignId}`;
    await sql`
      INSERT INTO auto_pause_events (workspace_id, rule_id, campaign_id, metric_value, action_taken, fired_at)
      VALUES (${workspaceId}, ${ruleId}, ${campaignId}, 12, 'pause_campaign', now())
    `;
    const res = await call("GET", `/analytics/diagnose/${campaignId}`);
    check(
      "a rule pause is diagnosed as such",
      res.json?.data?.diagnosis?.reason === "paused_by_rule",
      res.json?.data?.diagnosis,
    );
    await sql`DELETE FROM auto_pause_events WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM auto_pause_rules WHERE id = ${ruleId}`;
    await sql`UPDATE campaigns SET status = 'active' WHERE id = ${campaignId}`;
  }

  {
    // No leads enrolled.
    await sql`UPDATE campaign_leads SET state = 'stopped' WHERE lead_id = ${leadId}`;
    const res = await call("GET", `/analytics/diagnose/${campaignId}`);
    check(
      "a campaign with no active leads is waiting for leads",
      res.json?.data?.diagnosis?.reason === "waiting_for_leads",
      res.json?.data?.diagnosis,
    );
    await sql`UPDATE campaign_leads SET state = 'active' WHERE lead_id = ${leadId}`;
  }

  /* ------------------------ the campaigns list ------------------------ */

  console.log("\n7. the campaigns list shows real numbers");

  {
    const res = await call("GET", "/campaigns");
    const item = (res.json?.data?.items ?? []).find(
      (c: any) => c.id === campaignId,
    );
    check("the campaign is listed", Boolean(item));
    check("its sent count is real", item?.sent === 11, item?.sent);
    check("its replied count is real", item?.replied === 1, item?.replied);
    check("its opened count is real", item?.opened === 1, item?.opened);
    check(
      "its positive replies are real",
      item?.positiveReplies === 1,
      item?.positiveReplies,
    );
    check(
      "its opportunity value is real",
      item?.opportunityValue === 5000,
      item?.opportunityValue,
    );
    check("its bounced count is real", item?.bounced === 2, item?.bounced);
    check("it has a lead count", item?.leadCount === 1, item?.leadCount);
    check(
      "its progress is a real percentage",
      typeof item?.progress === "number" && item.progress >= 0,
      item?.progress,
    );
  }

  /* --------------------------- the overview --------------------------- */

  console.log("\n8. the overview carries the funnel");

  {
    const res = await call(
      "GET",
      "/analytics/overview?from=2000-01-01&to=2100-01-01",
    );
    check("the overview loads", res.status === 200, res.status);
    check("it carries a funnel", Boolean(res.json?.data?.funnel));
    check("it carries rates", Boolean(res.json?.data?.rates));
    check(
      "the funnel's sent matches the totals",
      res.json?.data?.funnel?.sent === res.json?.data?.totals?.sent,
      {
        funnel: res.json?.data?.funnel?.sent,
        totals: res.json?.data?.totals?.sent,
      },
    );
  }

  /* ------------------------------ cleanup ----------------------------- */

  console.log("\n9. cleanup");

  {
    await sql`DELETE FROM activities WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM opportunities WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaign_leads WHERE lead_id = ${leadId}`;
    await sql`DELETE FROM campaign_steps WHERE campaign_id IN (${campaignId}, ${fixtureCampaignId})`;
    await sql`DELETE FROM campaigns WHERE id = ${fixtureCampaignId}`;
    await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
    await sql`DELETE FROM leads WHERE id = ${leadId}`;

  // Hard guard: a test must never send to an example.com address.
  const exampleSends = await sql`
    SELECT count(*)::int AS n FROM send_jobs sj
    JOIN campaign_leads cl ON cl.id = sj.campaign_lead_id
    JOIN leads l ON l.id = cl.lead_id
    WHERE l.email LIKE '%@example.com'
  `;
  check(
    "no test email was sent to an example.com address",
    exampleSends[0]!.n === 0,
    exampleSends[0]!.n,
  );
    console.log("  ok   test data removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

await main();
