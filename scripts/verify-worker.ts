/**
 * Verifies the worker-side behaviour: a scheduled reply goes out when it is
 * due, and a campaign is auto-paused when its metrics cross a threshold.
 *
 * Both run on the scheduler's tick, so the test waits for a tick rather
 * than calling the service directly.
 *
 *   bun run scripts/verify-worker.ts
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
): Promise<{ status: number; json: any }> {
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

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  /* ------------------------ scheduled replies ------------------------- */

  console.log("\n2. a scheduled reply is sent when it is due");

  const contactEmail = `scheduled-${stamp}@example.com`;

  const leadRes = await call("POST", "/leads", {
    email: contactEmail,
    firstName: "Sam",
    lastName: "Rivera",
  });
  const leadId = leadRes.json?.data?.lead?.id ?? "";
  check("the lead was created", leadRes.status === 201, leadRes.status);

  const mailboxRows = await sql`SELECT id FROM mailboxes LIMIT 1`;
  const mailboxId = mailboxRows[0]!.id as string;

  const conversationRows = await sql`
    INSERT INTO conversations (
      workspace_id, mailbox_id, lead_id, contact_email, subject, has_reply,
      scheduled_reply_at, scheduled_reply_body
    )
    SELECT ws.id, ${mailboxId}, ${leadId}, ${contactEmail}, 'Re: quick question', 1,
           now() - interval '1 minute',
           '{"bodyHtml":"<p>Scheduled body</p>","bodyText":"Scheduled body","subject":"Re: quick question"}'
    FROM workspaces ws LIMIT 1
    RETURNING id
  `;
  const conversationId = conversationRows[0]!.id as string;
  check("a conversation with a due reply was seeded", Boolean(conversationId));

  {
    // Wait for the scheduler tick.
    let sent = false;
    for (let i = 0; i < 40; i++) {
      await sleep(2000);
      const rows = await sql`
        SELECT count(*)::int AS n FROM messages
        WHERE conversation_id = ${conversationId} AND direction = 'outbound'
      `;
      if (rows[0]!.n > 0) {
        sent = true;
        break;
      }
    }
    check("the scheduled reply was sent", sent);
  }

  {
    const rows = await sql`
      SELECT subject, text_body FROM messages
      WHERE conversation_id = ${conversationId} AND direction = 'outbound'
      ORDER BY received_at DESC LIMIT 1
    `;
    check(
      "the body is the scheduled one",
      String(rows[0]?.text_body ?? "").includes("Scheduled body"),
      rows[0]?.text_body,
    );
    check(
      "the subject is threaded",
      String(rows[0]?.subject ?? "").startsWith("Re:"),
      rows[0]?.subject,
    );
  }

  {
    const rows = await sql`
      SELECT scheduled_reply_at, scheduled_reply_body FROM conversations
      WHERE id = ${conversationId}
    `;
    check(
      "the schedule was cleared",
      rows[0]?.scheduled_reply_at === null,
      rows[0]?.scheduled_reply_at,
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM activities
      WHERE type = 'email_sent' AND meta->>'scheduled' = 'true'
    `;
    check("a scheduled email_sent activity was recorded", rows[0]!.n >= 1, rows[0]!.n);
  }

  /* ---------------------------- auto-pause ----------------------------- */

  console.log("\n3. a campaign is auto-paused when a metric crosses");

  const campaignRes = await call("POST", "/campaigns", {
    name: `Auto-pause verify ${stamp}`,
  });
  const campaignId = campaignRes.json?.data?.campaign?.id ?? "";
  check("the campaign was created", campaignRes.status === 201, campaignRes.status);

  // A campaign is only evaluated while it is running, so it has to be
  // launched — the same thing the operator does.
  const launchRes = await call("POST", `/campaigns/${campaignId}/launch`);
  check("the campaign was launched", launchRes.status === 200, launchRes.status);

  // Make the campaign look like it is bouncing badly: 10 sends, 4 bounces
  // is a 40% bounce rate.
  for (let i = 0; i < 10; i++) {
    await sql`
      INSERT INTO activities (workspace_id, campaign_id, type, meta, created_at)
      SELECT ws.id, ${campaignId}, 'email_sent', '{}'::jsonb, now() - interval '1 hour'
      FROM workspaces ws LIMIT 1
    `;
  }
  for (let i = 0; i < 4; i++) {
    await sql`
      INSERT INTO activities (workspace_id, campaign_id, type, meta, created_at)
      SELECT ws.id, ${campaignId}, 'bounced', '{}'::jsonb, now() - interval '1 hour'
      FROM workspaces ws LIMIT 1
    `;
  }

  const ruleRes = await call("POST", "/analytics/auto-pause-rules", {
    campaignId,
    metric: "bounce_rate",
    threshold: 5,
    direction: "above",
    action: "pause_campaign",
    enabled: true,
  });
  const ruleId = ruleRes.json?.data?.rule?.id ?? "";
  check("the rule was created", ruleRes.status === 201, ruleRes.status);

  {
    let paused = false;
    for (let i = 0; i < 40; i++) {
      await sleep(2000);
      const rows = await sql`
        SELECT status, paused_reason FROM campaigns WHERE id = ${campaignId}
      `;
      if (rows[0]?.status === "paused") {
        paused = true;
        check(
          "the pause says why",
          String(rows[0]?.paused_reason ?? "").includes("bounce rate"),
          rows[0]?.paused_reason,
        );
        break;
      }
    }
    check("the campaign was paused", paused);
  }

  {
    const rows = await sql`
      SELECT metric_value, action_taken FROM auto_pause_events WHERE rule_id = ${ruleId}
    `;
    check("an event was recorded", rows.length === 1, rows.length);
    check(
      "it recorded the metric value",
      Math.abs(Number(rows[0]?.metric_value ?? 0) - 40) < 1,
      rows[0]?.metric_value,
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM activities
      WHERE campaign_id = ${campaignId} AND type = 'status_changed'
    `;
    check("a status_changed activity was recorded", rows[0]!.n >= 1, rows[0]!.n);
  }

  /* --------------------------- a rule that does not fire ---------------- */

  console.log("\n4. a rule that is not breached does nothing");

  const safeCampaignRes = await call("POST", "/campaigns", {
    name: `Auto-pause safe ${stamp}`,
  });
  const safeCampaignId = safeCampaignRes.json?.data?.campaign?.id ?? "";

  const safeRuleRes = await call("POST", "/analytics/auto-pause-rules", {
    campaignId: safeCampaignId,
    metric: "bounce_rate",
    threshold: 90,
    direction: "above",
    enabled: true,
  });
  const safeRuleId = safeRuleRes.json?.data?.rule?.id ?? "";

  // Give the worker a couple of ticks.
  await sleep(35_000);

  {
    const rows = await sql`
      SELECT status FROM campaigns WHERE id = ${safeCampaignId}
    `;
    check(
      "the campaign is still running",
      rows[0]?.status !== "paused",
      rows[0]?.status,
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM auto_pause_events WHERE rule_id = ${safeRuleId}
    `;
    check("no event was recorded", rows[0]!.n === 0, rows[0]!.n);
  }

  /* ------------------------------ cleanup ------------------------------ */

  console.log("\n5. cleanup");

  {
    await sql`DELETE FROM activities WHERE campaign_id IN (${campaignId}, ${safeCampaignId})`;
    await sql`DELETE FROM messages WHERE conversation_id = ${conversationId}`;
    await sql`DELETE FROM conversations WHERE id = ${conversationId}`;
    await sql`DELETE FROM auto_pause_events WHERE rule_id IN (${ruleId}, ${safeRuleId})`;
    await sql`DELETE FROM auto_pause_rules WHERE id IN (${ruleId}, ${safeRuleId})`;
    await sql`DELETE FROM campaign_leads WHERE lead_id = ${leadId}`;
    await sql`DELETE FROM campaigns WHERE id IN (${campaignId}, ${safeCampaignId})`;
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
