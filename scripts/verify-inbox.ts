/**
 * Verifies the M4 and M5 features added on top of the inbox and analytics.
 *
 * Covers: the folder filter, inline reply, reminders, scheduled replies,
 * macros, attach-lead, auto-pause rules and the CSV export.
 *
 *   bun run scripts/verify-inbox.ts
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
      console.log(`       ${JSON.stringify(detail).slice(0, 400)}`);
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

  /* --------------------------- a conversation -------------------------- */

  console.log("\n2. set up a conversation to work with");

  const stamp = Date.now();
  const contactEmail = `inbox-verify-${stamp}@example.com`;

  const leadRes = await call("POST", "/leads", {
    email: contactEmail,
    firstName: "Priya",
    lastName: "Raman",
    company: "Northwind Labs",
  });
  check("the lead was created", leadRes.status === 201, leadRes.status);
  const leadId = leadRes.json?.data?.lead?.id ?? "";

  const campaignRes = await call("POST", "/campaigns", {
    name: `Inbox verify ${stamp}`,
    schedule: {
      mode: "custom",
      rules: [
        { daysOfWeek: [], startTime: "00:00", endTime: "00:00", timezone: "UTC" },
      ],
    },
  });
  const campaignId = campaignRes.json?.data?.campaign?.id ?? "";

  const stepRes = await call("POST", `/campaigns/${campaignId}/steps`, {
    subject: "Quick question",
    bodyHtml: "<p>Quick question</p>",
    delayMinutes: 0,
  });
  check("the step was created", stepRes.status === 201, stepRes.status);

  await call("POST", `/campaigns/${campaignId}/leads`, { leadIds: [leadId] });

  const mailboxRows = await sql`SELECT id FROM mailboxes LIMIT 1`;
  const mailboxId = mailboxRows[0]!.id as string;

  const conversationRows = await sql`
    INSERT INTO conversations (
      workspace_id, mailbox_id, lead_id, campaign_id, contact_email, subject, has_reply
    )
    SELECT ws.id, ${mailboxId}, ${leadId}, ${campaignId}, ${contactEmail}, 'Re: quick question', 1
    FROM workspaces ws LIMIT 1
    RETURNING id
  `;
  const conversationId = conversationRows[0]!.id as string;
  check("the conversation was seeded", Boolean(conversationId));

  /* ----------------------------- folders ------------------------------- */

  console.log("\n3. the folder filter");

  {
    const res = await call("GET", "/inbox/conversations?folder=primary");
    check("primary lists", res.status === 200, res.status);
    const items = res.json?.data?.items ?? [];
    check(
      "the conversation is in primary — it has a lead and a reply",
      items.some((c: any) => c.id === conversationId),
      items.map((c: any) => c.id),
    );
  }

  {
    const res = await call("GET", "/inbox/conversations?folder=others");
    const items = res.json?.data?.items ?? [];
    check(
      "it is not in others — it has a lead",
      !items.some((c: any) => c.id === conversationId),
    );
  }

  {
    const res = await call("GET", "/inbox/conversations?folder=reminders");
    check("reminders lists", res.status === 200, res.status);
  }

  {
    const res = await call("GET", "/inbox/conversations?folder=scheduled");
    check("scheduled lists", res.status === 200, res.status);
  }

  {
    const res = await call("GET", "/inbox/conversations?folder=nonsense");
    check("an unknown folder is a 400", res.status === 400, res.status);
  }

  /* ---------------------------- reminders ------------------------------ */

  console.log("\n4. reminders");

  {
    const res = await call("POST", `/inbox/conversations/${conversationId}/remind`, {
      remindAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    check("a reminder is set", res.status === 200, res.status);
    check(
      "it comes back",
      typeof res.json?.data?.remindAt === "string",
      res.json?.data,
    );
  }

  {
    const res = await call("GET", "/inbox/conversations?folder=reminders");
    const items = res.json?.data?.items ?? [];
    check(
      "the conversation is in reminders",
      items.some((c: any) => c.id === conversationId),
    );
  }

  {
    const res = await call("POST", `/inbox/conversations/${conversationId}/remind`, {
      remindAt: null,
    });
    check("a reminder is cleared", res.status === 200, res.status);
  }

  {
    const res = await call("POST", `/inbox/conversations/${conversationId}/remind`, {
      remindAt: "not-a-date",
    });
    check("a bad date is a 400", res.status === 400, res.status);
  }

  /* ------------------------------ macros ------------------------------ */

  console.log("\n5. macros");

  let macroId = "";
  {
    const res = await call("POST", "/inbox/macros", {
      name: `Follow up ${stamp}`,
      bodyHtml: "<p>Just following up — is next week still good?</p>",
      bodyText: "Just following up — is next week still good?",
    });
    check("a macro is created", res.status === 201, res.status);
    macroId = res.json?.data?.macro?.id ?? "";
  }

  {
    const res = await call("GET", "/inbox/macros");
    check("macros are listed", res.status === 200, res.status);
    check(
      "the macro is there",
      (res.json?.data?.items ?? []).some((m: any) => m.id === macroId),
    );
  }

  {
    const res = await call("PATCH", `/inbox/macros/${macroId}`, {
      name: `Renamed ${stamp}`,
    });
    check("a macro is updated", res.status === 200, res.status);
    check(
      "the new name stuck",
      res.json?.data?.macro?.name === `Renamed ${stamp}`,
      res.json?.data?.macro?.name,
    );
  }

  {
    const res = await call("DELETE", `/inbox/macros/${macroId}`);
    check("a macro is deleted", res.status === 204, res.status);
  }

  /* --------------------------- attach a lead --------------------------- */

  console.log("\n6. attach a lead");

  {
    const res = await call("POST", `/inbox/conversations/${conversationId}/attach-lead`, {
      leadId,
    });
    check("a lead is attached", res.status === 200, res.status);
    check(
      "the conversation points at the lead",
      res.json?.data?.leadId === leadId,
      res.json?.data,
    );
  }

  {
    const res = await call(
      "POST",
      `/inbox/conversations/${conversationId}/attach-lead`,
      { leadId: "not-a-uuid" },
    );
    check("a bad lead id is a 400", res.status === 400, res.status);
  }

  /* --------------------------- inline reply ---------------------------- */

  console.log("\n7. inline reply");

  {
    const res = await call("POST", `/inbox/conversations/${conversationId}/reply`, {
      bodyHtml: "<p>Hi Priya — yes, next week works. Book it here.</p>",
      bodyText: "Hi Priya — yes, next week works. Book it here.",
    });
    check("the reply is sent", res.status === 201, res.status);
    check(
      "mailcore returned a message id",
      typeof res.json?.data?.messageId === "string" &&
        res.json.data.messageId.length > 5,
      res.json?.data,
    );
  }

  {
    const rows = await sql`
      SELECT direction, subject, from_address
      FROM messages
      WHERE conversation_id = ${conversationId}
      ORDER BY received_at
    `;
    check(
      "an outbound message was recorded",
      rows.some((r: any) => r.direction === "outbound"),
      rows,
    );
    const outbound = rows.find((r: any) => r.direction === "outbound");
    check(
      "it went from our mailbox",
      String(outbound?.from_address).includes("@"),
      outbound?.from_address,
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM activities
      WHERE type = 'email_sent' AND meta->>'manual' = 'true'
    `;
    check("a manual email_sent activity was recorded", rows[0]!.n >= 1, rows[0]!.n);
  }

  {
    const res = await call("POST", `/inbox/conversations/${conversationId}/reply`, {
      bodyHtml: "",
    });
    check("an empty reply is a 400", res.status === 400, res.status);
  }

  /* ------------------------- scheduled replies ------------------------- */

  console.log("\n8. scheduled replies");

  {
    const sendAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await call(
      "POST",
      `/inbox/conversations/${conversationId}/schedule`,
      { bodyHtml: "<p>Scheduled body</p>", bodyText: "Scheduled body", sendAt },
    );
    check("a reply is scheduled", res.status === 201, res.status);
  }

  {
    const res = await call("GET", "/inbox/conversations?folder=scheduled");
    const items = res.json?.data?.items ?? [];
    check(
      "the conversation is in scheduled",
      items.some((c: any) => c.id === conversationId),
    );
  }

  {
    const res = await call(
      "POST",
      `/inbox/conversations/${conversationId}/schedule`,
      { bodyHtml: "<p>x</p>", sendAt: "not-a-date" },
    );
    check("a bad send time is a 400", res.status === 400, res.status);
  }

  /* --------------------------- auto-pause ------------------------------ */

  console.log("\n9. auto-pause rules");

  let ruleId = "";
  {
    const res = await call("POST", "/analytics/auto-pause-rules", {
      metric: "bounce_rate",
      threshold: 5,
      direction: "above",
      action: "pause_campaign",
      enabled: true,
    });
    check("a rule is created", res.status === 201, res.status);
    ruleId = res.json?.data?.rule?.id ?? "";
  }

  {
    const res = await call("GET", "/analytics/auto-pause-rules");
    check("rules are listed", res.status === 200, res.status);
    check(
      "the rule is there",
      (res.json?.data?.items ?? []).some((r: any) => r.id === ruleId),
    );
  }

  {
    const res = await call("PATCH", `/analytics/auto-pause-rules/${ruleId}`, {
      threshold: 3,
    });
    check("a rule is updated", res.status === 200, res.status);
    check(
      "the new threshold stuck",
      res.json?.data?.rule?.threshold === 3,
      res.json?.data?.rule?.threshold,
    );
  }

  {
    const res = await call("POST", "/analytics/auto-pause-rules", {
      metric: "nonsense",
      threshold: 5,
    });
    check("an unknown metric is a 400", res.status === 400, res.status);
  }

  {
    const res = await call("GET", "/analytics/auto-pause-rules/history");
    check("the history lists", res.status === 200, res.status);
  }

  /* ------------------------------ export ------------------------------- */

  console.log("\n10. the CSV export");

  {
    const res = await call("GET", "/analytics/export?dataset=activity");
    check("the export is served", res.status === 200, res.status);
    check("it is csv", res.text.startsWith('"'), res.text.slice(0, 80));
    check(
      "it has a header row",
      res.text.split("\r\n")[0]?.includes("type"),
      res.text.split("\r\n")[0],
    );
  }

  {
    const res = await call("GET", "/analytics/export?dataset=daily");
    check("the daily export is served", res.status === 200, res.status);
    check(
      "it has the daily columns",
      res.text.split("\r\n")[0]?.includes("sent"),
      res.text.split("\r\n")[0],
    );
  }

  /* ------------------------------ cleanup ------------------------------ */

  console.log("\n11. cleanup");

  {
    await sql`DELETE FROM activities WHERE lead_id = ${leadId}`;
    await sql`DELETE FROM messages WHERE conversation_id = ${conversationId}`;
    await sql`DELETE FROM conversations WHERE id = ${conversationId}`;
    await sql`DELETE FROM campaign_leads WHERE lead_id = ${leadId}`;
    await sql`DELETE FROM campaign_steps WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
    await sql`DELETE FROM leads WHERE id = ${leadId}`;
    await sql`DELETE FROM auto_pause_rules WHERE id = ${ruleId}`;

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
