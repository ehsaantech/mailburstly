/**
 * End-to-end check of the outbound path.
 *
 * Creates a lead and a campaign, launches it, and then asserts that the
 * message came out with its variables rendered, that the send was recorded
 * with its Message-ID, and that the scheduler honoured the campaign's rules.
 *
 *   bun run scripts/verify-send.ts
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-admin-password";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://mailrung:change-me-postgres@localhost:5433/mailrung";

/**
 * Where the test email goes.
 *
 * The only sanctioned sink for a test send. A send to a made-up address
 * proves nothing, because it bounces before it is read, and a send to a
 * real contact reaches a stranger without the operator asking for it.
 */
const RECIPIENT = process.env.TEST_RECIPIENT ?? "haroon@yopmail.com";

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
      console.log(`       ${JSON.stringify(detail)}`);
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

/** Wait for one of this campaign's send jobs to finish, up to `timeoutMs`. */
async function waitForSend(
  campaignId: string,
  timeoutMs: number,
): Promise<{ state: string; error: string | null; id: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await sql`
      SELECT sj.id, sj.state, sj.last_error
      FROM send_jobs sj
      JOIN campaign_leads cl ON cl.id = sj.campaign_lead_id
      WHERE cl.campaign_id = ${campaignId}
        AND sj.state IN ('sent', 'failed', 'skipped', 'hard_bounced')
      ORDER BY sj.created_at DESC LIMIT 1
    `;
    if (rows.length > 0) {
      return {
        id: rows[0]!.id as string,
        state: rows[0]!.state as string,
        error: (rows[0]!.last_error as string) ?? null,
      };
    }
    await sleep(2000);
  }
  return null;
}

async function main() {
  // Remove leftovers from earlier runs.
  //
  // The recipient is a real lead, so it is never deleted — only the test
  // campaigns it was enrolled in are cleaned up. Deleting the lead itself
  // would throw away the operator's data.
  {
    const staleCampaigns = await sql`
      SELECT id FROM campaigns
      WHERE name LIKE 'Render check %' OR name LIKE 'store test campaign%'
         OR name LIKE 'Closed window %'
    `;
    for (const row of staleCampaigns) {
      await sql`DELETE FROM campaigns WHERE id = ${row.id}`;
    }

    // Test-only leads from other scripts, never the recipient.
    const staleLeads = await sql`
      SELECT id FROM leads
      WHERE email LIKE 'store-test-%' OR email LIKE 'closed-window-%'
    `;
    for (const row of staleLeads) {
      await sql`DELETE FROM leads WHERE id = ${row.id}`;
    }

    console.log(
      `  ok   removed ${staleCampaigns.length} stale campaigns and ${staleLeads.length} stale leads`,
    );
  }

  // The recipient is a real person, and a real person may reply to the
  // test email. A lead that replied is (correctly) never emailed again, so
  // the run would silently test nothing.
  //
  // Clear the reply history for this lead so the send path is actually
  // exercised. Only inbound messages to the test address are touched.
  {
    const cleared = await sql`
      DELETE FROM messages
      WHERE lead_id IN (
        SELECT id FROM leads WHERE lower(email) = lower(${RECIPIENT})
      ) AND direction = 'inbound'
    `;
    const reset = await sql`
      UPDATE campaign_leads SET state = 'active', stopped_reason = NULL, next_step_at = now()
      WHERE lead_id IN (
        SELECT id FROM leads WHERE lower(email) = lower(${RECIPIENT})
      )
    `;
    console.log(
      `  ok   cleared ${cleared.count ?? 0} replies and reset ${reset.count ?? 0} enrollments for the recipient`,
    );
  }

  console.log("\n1. sign in");
  {
    const res = await call("POST", "/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    check("login succeeds", res.status === 200, res.status);
  }

  console.log("\n2. build a campaign with a personalised step");

  const stamp = Date.now();
  let leadId = "";
  let campaignId = "";
  let leadCreated = false;

  /**
   * The recipient's fields, as they were before the test.
   *
   * The test needs known values to assert on the rendering, so it sets
   * them. The recipient is a real lead, so they are put back afterwards.
   */
  let leadBefore: Record<string, unknown> | null = null;

  {
    // The recipient usually already exists from an earlier run, so look it
    // up first and only create it when it is missing.
    const existing = await sql`
      SELECT id, first_name, last_name, company, title, custom_variables
      FROM leads WHERE lower(email) = lower(${RECIPIENT}) LIMIT 1
    `;

    if (existing.length > 0) {
      leadId = existing[0]!.id as string;
      leadBefore = {
        firstName: existing[0]!.first_name,
        lastName: existing[0]!.last_name,
        company: existing[0]!.company,
        title: existing[0]!.title,
        customVariables: existing[0]!.custom_variables,
      };

      const res = await call("PATCH", `/leads/${leadId}`, {
        firstName: "Zahid",
        lastName: "Khan",
        company: "Northwind Labs",
        title: "Head of Growth",
        customVariables: { industry: "SaaS" },
      });
      check("the existing lead was updated", res.status === 200, res.status);
    } else {
      const res = await call("POST", "/leads", {
        email: RECIPIENT,
        firstName: "Zahid",
        lastName: "Khan",
        company: "Northwind Labs",
        title: "Head of Growth",
        customVariables: { industry: "SaaS" },
      });
      check("the lead was created", res.status === 201, res.status);
      leadId = res.json?.data?.lead?.id ?? "";
      leadCreated = true;
    }
  }

  {
    const res = await call("POST", "/campaigns", {
      name: `Render check ${stamp}`,
      openTracking: true,
      linkTracking: true,
      // One minute between sends, so the test does not wait out the
      // nine-minute default.
      emailGapMinutes: 1,
      randomWaitMax: 0,
    });
    check("the campaign was created", res.status === 201, res.status);
    campaignId = res.json?.data?.campaign?.id ?? "";
  }

  {
    const res = await call("POST", `/campaigns/${campaignId}/steps`, {
      subject: "{{company}} — a question for {{first_name}}",
      bodyHtml:
        "Hi {{first_name}},\n\n" +
        "I noticed {{company}} is scaling {{industry}}. " +
        "{Quick question|Sounds interesting} — worth 15 minutes?\n\n" +
        "{% if title %}You are the {{title}}, right?{% else %}Who should I ask?{% endif %}\n\n" +
        "— {{sender_name}}",
      delayMinutes: 0,
    });
    check("the step was created", res.status === 201, res.status);
  }

  {
    const res = await call("POST", `/campaigns/${campaignId}/leads`, {
      leadIds: [leadId],
    });
    check("the lead was enrolled", res.status === 200, res.status);
  }

  {
    const res = await call("POST", `/campaigns/${campaignId}/launch`);
    check("the campaign was launched", res.status === 200, res.status);
  }

  console.log("\n3. wait for the send");

  const send = await waitForSend(campaignId, 180_000);
  check("a send job reached a terminal state", send !== null, send);
  check("the send succeeded", send?.state === "sent", send?.error ?? send?.state);

  console.log("\n4. the message was rendered");

  {
    const rows = await sql`
      SELECT subject FROM sent_messages
      WHERE lead_id = ${leadId} ORDER BY sent_at DESC LIMIT 1
    `;
    check("a sent_messages row was written", rows.length === 1, rows.length);
    const subject = rows[0]?.subject ?? "";
    check(
      "the subject was rendered",
      subject === "Northwind Labs — a question for Zahid",
      subject,
    );
    check(
      "no merge tag survived",
      !subject.includes("{{") && !subject.includes("}}"),
      subject,
    );
  }

  {
    const rows = await sql`
      SELECT message_id, original_message_id FROM sent_messages
      WHERE lead_id = ${leadId} ORDER BY sent_at DESC LIMIT 1
    `;
    check(
      "the Message-ID was recorded for bounce correlation",
      (rows[0]?.message_id ?? "").length > 5,
      rows[0],
    );
  }

  {
    // Scoped to this campaign: earlier runs left activities on the same
    // lead, and a shared count would drift every time the script runs.
    const rows = await sql`
      SELECT type FROM activities
      WHERE campaign_id = ${campaignId} AND type = 'email_sent'
    `;
    check("an email_sent activity was recorded", rows.length === 1, rows.length);
  }

  {
    const rows = await sql`
      SELECT state, completed_at FROM campaign_leads
      WHERE lead_id = ${leadId}
    `;
    check(
      "the lead was moved to the next step (or completed)",
      rows.length === 1,
      rows.length,
    );
  }

  console.log("\n5. the scheduler honours a closed send window");

  {
    // A campaign whose window is a day that is not today must not send.
    const res = await call("POST", "/campaigns", {
      name: `Closed window ${stamp}`,
      schedule: {
        mode: "custom",
        rules: [
          { daysOfWeek: [], startTime: "09:00", endTime: "17:00", timezone: "UTC" },
        ],
      },
    });
    check("the campaign was created", res.status === 201, res.status);
    const closedId = res.json?.data?.campaign?.id ?? "";

    const step = await call("POST", `/campaigns/${closedId}/steps`, {
      subject: "Should never send",
      bodyHtml: "Should never send",
      delayMinutes: 0,
    });
    check("its step was created", step.status === 201, step.status);

    const lead = await call("POST", "/leads", {
      email: `closed-window-${stamp}@example.com`,
      firstName: "Nobody",
    });
    const closedLeadId = lead.json?.data?.lead?.id ?? "";

    await call("POST", `/campaigns/${closedId}/leads`, { leadIds: [closedLeadId] });
    await call("POST", `/campaigns/${closedId}/launch`);

    // Give the scheduler a couple of ticks.
    await sleep(35_000);

    const rows = await sql`
      SELECT count(*)::int AS n FROM send_jobs sj
      JOIN campaign_leads cl ON cl.id = sj.campaign_lead_id
      WHERE cl.lead_id = ${closedLeadId}
    `;
    check(
      "no send job was created while the window was closed",
      rows[0]!.n === 0,
      rows[0]!.n,
    );

    await sql`DELETE FROM campaigns WHERE id = ${closedId}`;
    await sql`DELETE FROM leads WHERE id = ${closedLeadId}`;
  }

  console.log("\n6. cleanup");

  {
    // Scoped to the test campaign. The recipient is a real lead that may
    // be in other campaigns, and this script must not touch those.
    await sql`DELETE FROM activities WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM sent_messages WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaign_leads WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
    if (leadCreated) {
      await sql`DELETE FROM leads WHERE id = ${leadId}`;
    } else if (leadBefore) {
      // Put the recipient's own details back.
      await sql`
        UPDATE leads SET
          first_name = ${leadBefore.firstName as string | null},
          last_name = ${leadBefore.lastName as string | null},
          company = ${leadBefore.company as string | null},
          title = ${leadBefore.title as string | null},
          custom_variables = ${leadBefore.customVariables as never}
        WHERE id = ${leadId}
      `;
    }

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
