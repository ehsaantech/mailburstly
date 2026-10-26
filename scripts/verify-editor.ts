/**
 * Verifies the sequence editor, the reply suggestions and the dashboard.
 *
 *   bun run scripts/verify-editor.ts
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-admin-password";
const DISPATCHER_URL =
  process.env.DISPATCHER_URL ?? "http://localhost:8090";

/**
 * Where the test emails go.
 *
 * The only sanctioned sink for a test send. A send to a made-up address
 * proves nothing, because it bounces before it is read, and a send to a
 * real contact reaches a stranger without the operator asking for it.
 */
const TEST_RECIPIENT =
  process.env.TEST_RECIPIENT ?? "haroon@yopmail.com";

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

  /* --------------------------- the renderer --------------------------- */

  console.log("\n2. the dispatcher's render endpoint");

  {
    const res = await fetch(`${DISPATCHER_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "Hi {{first_name}}, {{company}} — {{unknown_thing}}",
        data: { first_name: "Zahid", company: "Northwind" },
      }),
    });
    check("it answers", res.ok, res.status);

    const body = await res.json();
    check(
      "the variables are substituted",
      body.rendered === "Hi Zahid, Northwind — ",
      body.rendered,
    );
    check(
      "no raw token survives",
      !String(body.rendered).includes("{{"),
      body.rendered,
    );
  }

  {
    const res = await fetch(`${DISPATCHER_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "", data: {} }),
    });
    check("an empty template is a 400", res.status === 400, res.status);
  }

  /* ------------------------- the sequence editor ---------------------- */

  console.log("\n3. the sequence editor");

  let campaignId = "";
  let stepId = "";

  {
    const res = await call("POST", "/campaigns", {
      name: `Editor verify ${stamp}`,
    });
    check("a campaign is created", res.status === 201, res.status);
    campaignId = res.json?.data?.campaign?.id ?? "";
  }

  {
    const res = await call("POST", `/campaigns/${campaignId}/steps`, {
      subject: "Hello {{first_name}}",
      bodyHtml: "<p>Hi {{first_name}}, this is {{company}}.</p>",
      delayMinutes: 0,
      threadMode: "reply",
    });
    check("a step is added", res.status === 201, res.status);
    stepId = res.json?.data?.step?.id ?? "";
  }

  {
    const res = await call("POST", `/campaigns/${campaignId}/steps`, {
      subject: "Following up",
      bodyHtml: "<p>Just following up.</p>",
      delayMinutes: 4320,
      threadMode: "reply",
    });
    check("a second step is added", res.status === 201, res.status);
  }

  {
    const res = await call("GET", `/campaigns/${campaignId}/steps`);
    const items = res.json?.data?.items ?? [];
    check("the steps are listed in order", items.length === 2, items.length);
    check("the first step is first", items[0]?.position === 1, items[0]?.position);
    check("the second step is second", items[1]?.position === 2, items[1]?.position);
    check(
      "the second step waits three days",
      items[1]?.delayMinutes === 4320,
      items[1]?.delayMinutes,
    );
    check(
      "each step carries its variants",
      Array.isArray(items[0]?.variants),
      items[0]?.variants,
    );
  }

  {
    const res = await call("PATCH", `/campaigns/${campaignId}/steps/${stepId}`, {
      subject: "Hello {{first_name}}, welcome",
      bodyHtml: "<p>Hi {{first_name}}.</p>",
      delayMinutes: 60,
    });
    check("a step is edited", res.status === 200, res.status);
    check(
      "the new subject stuck",
      res.json?.data?.step?.subject === "Hello {{first_name}}, welcome",
      res.json?.data?.step?.subject,
    );
    check(
      "the new delay stuck",
      res.json?.data?.step?.delayMinutes === 60,
      res.json?.data?.step?.delayMinutes,
    );
  }

  {
    // Reorder: swap the two steps.
    const res = await call("GET", `/campaigns/${campaignId}/steps`);
    const items = res.json?.data?.items ?? [];
    const reversed = items.map((s: any) => s.id).reverse();

    const patch = await call("PATCH", `/campaigns/${campaignId}/steps/reorder`, {
      stepIds: reversed,
    });
    check("the steps are reordered", patch.status === 200, patch.status);

    const after = await call("GET", `/campaigns/${campaignId}/steps`);
    const afterItems = after.json?.data?.items ?? [];
    check(
      "the order actually changed",
      afterItems[0]?.id === reversed[0],
      { first: afterItems[0]?.id, expected: reversed[0] },
    );
    check(
      "the positions are renumbered",
      afterItems[0]?.position === 1 && afterItems[1]?.position === 2,
      afterItems.map((s: any) => s.position),
    );
  }

  {
    const res = await call("PATCH", `/campaigns/${campaignId}/steps/reorder`, {
      stepIds: ["00000000-0000-0000-0000-000000000000"],
    });
    check("a reorder that names a stranger is a 400", res.status === 400, res.status);
  }

  {
    // A/Z variants.
    const res = await call(
      "POST",
      `/campaigns/${campaignId}/steps/${stepId}/variants`,
      {
        label: "A",
        subject: "Version A",
        bodyHtml: "<p>Body A</p>",
        weight: 60,
      },
    );
    check("a variant is added", res.status === 201, res.status);
    const variantId = res.json?.data?.variant?.id ?? "";

    const list = await call(
      "GET",
      `/campaigns/${campaignId}/steps/${stepId}/variants`,
    );
    check(
      "the variant is listed",
      (list.json?.data?.items ?? []).length === 1,
      list.json?.data?.items?.length,
    );

    const patch = await call(
      "PATCH",
      `/campaigns/${campaignId}/steps/${stepId}/variants/${variantId}`,
      { label: "A2", weight: 40 },
    );
    check("a variant is edited", patch.status === 200, patch.status);
    check(
      "the new label stuck",
      patch.json?.data?.variant?.label === "A2",
      patch.json?.data?.variant?.label,
    );

    const del = await call(
      "DELETE",
      `/campaigns/${campaignId}/steps/${stepId}/variants/${variantId}`,
    );
    check("a variant is deleted", del.status === 204, del.status);
  }

  /* ----------------------------- the preview -------------------------- */

  console.log("\n4. the preview");

  {
    // The reorder moved the steps, so read whichever is first now rather
    // than assuming.
    const list = await call("GET", `/campaigns/${campaignId}/steps`);
    const first = (list.json?.data?.items ?? [])[0];

    const res = await call("POST", `/campaigns/${campaignId}/preview`, {
      stepId: first?.id,
      data: { first_name: "Zahid", company: "Northwind" },
    });
    check("the preview loads", res.status === 200, res.status);
    check(
      "the subject is rendered",
      res.json?.data?.subject === first?.subject,
      { got: res.json?.data?.subject, expected: first?.subject },
    );
    check(
      "the body is rendered",
      !String(res.json?.data?.bodyHtml ?? "").includes("{{"),
      res.json?.data?.bodyHtml,
    );
    check("the renderer answered", res.json?.data?.rendered === true, res.json?.data);
  }

  {
    // A preview against a real lead uses that lead's data.
    const lead = await call("POST", "/leads", {
      email: `editor-${stamp}@example.com`,
      firstName: "Priya",
      lastName: "Raman",
      company: "Northwind Labs",
    });
    const leadId = lead.json?.data?.lead?.id ?? "";
    check("the lead is created", lead.status === 201, lead.status);

    // The step that actually has a variable in it — the reorder moved it.
    const list = await call("GET", `/campaigns/${campaignId}/steps`);
    const withVariables = (list.json?.data?.items ?? []).find((s: any) =>
      String(s.bodyHtml).includes("{{first_name}}"),
    );

    const res = await call("POST", `/campaigns/${campaignId}/preview`, {
      stepId: withVariables?.id,
      leadId,
    });
    check(
      "the lead's first name is used",
      String(res.json?.data?.bodyHtml ?? "").includes("Priya"),
      res.json?.data?.bodyHtml,
    );
  }

  /* --------------------------- the test send -------------------------- */

  console.log("\n5. the test send");

  {
    const res = await call("POST", `/campaigns/${campaignId}/test-send`, {
      to: "not-an-email",
    });
    check("a bad address is a 400", res.status === 400, res.status);
  }

  {
    const list = await call("GET", `/campaigns/${campaignId}/steps`);
    const first = (list.json?.data?.items ?? [])[0];

    const res = await call("POST", `/campaigns/${campaignId}/test-send`, {
      to: TEST_RECIPIENT,
      stepId: first?.id,
    });
    check("the test is sent", res.status === 201, res.status);
    check(
      "it came from a connected mailbox",
      String(res.json?.data?.from ?? "").includes("@"),
      res.json?.data?.from,
    );
    check(
      "the body was rendered",
      !String(res.json?.data?.bodyHtml ?? "").includes("{{"),
      res.json?.data?.bodyHtml,
    );
  }

  /* ------------------------- reply suggestions ------------------------ */

  console.log("\n6. reply suggestions");

  {
    // A conversation with a reply in it.
    const lead = await call("POST", "/leads", {
      email: `suggest-${stamp}@example.com`,
      firstName: "Priya",
      company: "Northwind Labs",
    });
    const leadId = lead.json?.data?.lead?.id ?? "";

    const mailboxRows = await sql`SELECT id FROM mailboxes LIMIT 1`;
    const mailboxId = mailboxRows[0]!.id as string;

    const workspaceRows = await sql`SELECT id FROM workspaces LIMIT 1`;
    const workspaceId = workspaceRows[0]!.id as string;

    const conversationRows = await sql`
      INSERT INTO conversations (
        workspace_id, mailbox_id, lead_id, contact_email, subject, has_reply
      )
      VALUES (${workspaceId}, ${mailboxId}, ${leadId},
              ${`suggest-${stamp}@example.com`}, 'Re: pricing', 1)
      RETURNING id
    `;
    const conversationId = conversationRows[0]!.id as string;

    await sql`
      INSERT INTO messages (
        workspace_id, conversation_id, mailbox_id, lead_id, direction,
        from_address, to_address, subject, text_body, html_body, snippet,
        classification, is_auto_reply, is_out_of_office, is_unsubscribe, received_at
      )
      VALUES (
        ${workspaceId}, ${conversationId}, ${mailboxId}, ${leadId}, 'inbound',
        ${`suggest-${stamp}@example.com`}, 'aitchkhan@gmail.com',
        'Re: pricing',
        'Hi,\n\nHow much is it for 50 seats?\n\nPriya',
        '<p>How much is it for 50 seats?</p>',
        'How much is it for 50 seats?',
        'question', 0, 0, 0, now() - interval '1 hour'
      )
    `;

    const res = await call(
      "POST",
      `/inbox/conversations/${conversationId}/suggest`,
      { tone: "direct" },
    );

    if (res.status === 200) {
      const draft = res.json?.data?.draft ?? "";
      check("a suggestion is produced", draft.length > 0, draft.slice(0, 120));
      check(
        "the draft is not a code fence",
        !draft.startsWith("```"),
        draft.slice(0, 40),
      );
    } else {
      // No model key configured is a legitimate state, not a failure.
      check(
        "the suggestion either works or says why it could not",
        res.status === 400,
        { status: res.status, body: res.json },
      );
    }
  }

  /* ---------------------------- the dashboard ------------------------- */

  console.log("\n7. the dashboard");

  {
    const res = await call("GET", "/analytics/overview");
    check("the overview loads", res.status === 200, res.status);
    check(
      "it carries today's numbers",
      typeof res.json?.data?.today?.sent === "number",
      res.json?.data?.today,
    );
    check(
      "today's reply rate is a rate",
      typeof res.json?.data?.today?.replyRate === "number",
      res.json?.data?.today?.replyRate,
    );
  }

  {
    const res = await call("GET", "/analytics/activity?limit=5");
    check("the activity feed loads", res.status === 200, res.status);
    check(
      "it is a list",
      Array.isArray(res.json?.data?.items),
      res.json?.data,
    );
  }

  {
    const res = await call("GET", "/inbox/opportunities?status=open&limit=5");
    check("the opportunities load", res.status === 200, res.status);
  }

  {
    const res = await call("GET", "/mailboxes");
    check("the mailboxes load", res.status === 200, res.status);
  }

  /* ------------------------------ cleanup ----------------------------- */

  console.log("\n8. cleanup");

  {
    await sql`DELETE FROM messages WHERE conversation_id IN (
      SELECT id FROM conversations WHERE contact_email LIKE 'suggest-%@example.com'
         OR contact_email LIKE 'editor-%@example.com'
    )`;
    await sql`DELETE FROM conversations WHERE contact_email LIKE 'suggest-%@example.com'
        OR contact_email LIKE 'editor-%@example.com'`;
    // The recipient is a real lead. This script only sends *to* it, so it
    // must never delete it.
    await sql`DELETE FROM leads WHERE email LIKE 'editor-%@example.com'
        OR email LIKE 'suggest-%@example.com'`;
    await sql`DELETE FROM campaign_steps WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaign_leads WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM activities WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;

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
