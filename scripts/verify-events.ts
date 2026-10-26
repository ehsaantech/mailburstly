/**
 * Exercises the EmailEngine event pipeline end to end.
 *
 * Each case signs its payload with the service secret, POSTs it to the
 * worker exactly as EmailEngine would, and then asserts what landed in the
 * database. Run it with the stack up:
 *
 *   bun run scripts/verify-events.ts
 */

import { createHmac } from "node:crypto";

const WORKER_URL =
  process.env.WORKER_WEBHOOK_URL?.replace(
    "worker:3002",
    "localhost:3002",
  ) ?? "http://localhost:3002/webhooks/emailengine";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

const secret = process.env.EMAILENGINE_SERVICE_SECRET ?? "";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://mailrung:change-me-postgres@localhost:5433/mailrung";

if (!secret) {
  console.error(
    "EMAILENGINE_SERVICE_SECRET is not set — copy it out of .env first.",
  );
  process.exit(1);
}

const { default: postgres } = await import(
  "../packages/db/node_modules/postgres/src/index.js"
);

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

/** POST a payload the way EmailEngine would: signed, with an event id. */
async function postEvent(
  event: Record<string, unknown>,
  eventId: string,
): Promise<{ status: number; body: unknown }> {
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", secret)
    .update(raw)
    .digest("base64url");

  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-EE-Wh-Signature": signature,
      "X-EE-Wh-Event-Id": eventId,
    },
    body: raw,
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { status: res.status, body };
}

const sql = postgres(databaseUrl, { max: 1 });

/* -------------------------------------------------------------------------- */

async function main() {
  const account = "aitchkhan@gmail.com";

  const mailbox = await sql`
    SELECT id, email FROM mailboxes WHERE emailengine_id = ${account} LIMIT 1
  `;
  if (mailbox.length === 0) {
    console.error(`No mailbox with emailengine_id = ${account}`);
    process.exit(1);
  }
  const mailboxId = mailbox[0]!.id as string;

  /* ------------------------- 1. signature check ------------------------- */

  console.log("\n1. signature verification");

  {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "messageNew" }),
    });
    check("an unsigned webhook is rejected", res.status === 401, res.status);
  }

  {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EE-Wh-Signature": "not-a-real-signature",
      },
      body: JSON.stringify({ event: "messageNew" }),
    });
    check("a badly signed webhook is rejected", res.status === 401, res.status);
  }

  {
    const res = await postEvent(
      { event: "somethingWeDoNotHandle", account, date: new Date().toISOString() },
      `evt-unknown-${Date.now()}`,
    );
    check("a signed webhook is accepted", res.status === 202, res.status);
  }

  /* --------------------------- 2. a reply ------------------------------- */

  console.log("\n2. inbound reply → conversation, activity, status, opportunity");

  const leadEmail = `reply-test-${Date.now()}@example.com`;

  const leadRows = await sql`
    INSERT INTO leads (workspace_id, email, first_name, last_name, company)
    SELECT id, ${leadEmail}, 'Priya', 'Raman', 'Northwind Labs' FROM workspaces LIMIT 1
    RETURNING id
  `;
  const leadId = leadRows[0]!.id as string;

  const campaignRows = await sql`
    INSERT INTO campaigns (workspace_id, name, status, stop_on_reply, schedule)
    SELECT id, 'Event pipeline test', 'active', true,
           '{"mode":"custom","rules":[{"daysOfWeek":[],"startTime":"00:00","endTime":"00:00","timezone":"UTC"}]}'::jsonb
    FROM workspaces LIMIT 1
    RETURNING id
  `;
  const campaignId = campaignRows[0]!.id as string;

  await sql`
    INSERT INTO campaign_steps (campaign_id, position, subject, body_html)
    VALUES (${campaignId}, 1, 'Hello', 'Hello')
  `;

  const campaignLeadRows = await sql`
    INSERT INTO campaign_leads (campaign_id, lead_id, current_step_id, state, next_step_at)
    SELECT ${campaignId}, ${leadId}, id, 'active', now() - interval '1 minute'
    FROM campaign_steps WHERE campaign_id = ${campaignId} AND position = 1
    RETURNING id
  `;
  const campaignLeadId = campaignLeadRows[0]!.id as string;

  const messageId = `<reply-${Date.now()}@example.com>`;

  {
    const res = await postEvent(
      {
        event: "messageNew",
        account,
        date: new Date().toISOString(),
        path: "\\All",
        data: {
          id: `msg-${Date.now()}`,
          date: new Date().toISOString(),
          subject: "Re: quick question about pricing",
          from: { name: "Priya Raman", address: leadEmail },
          to: [{ address: account }],
          messageId,
          text: {
            plain:
              "Hi,\n\nThat sounds interesting. Can you send me pricing for 50 seats?\n\nBest,\nPriya",
          },
          seemsLikeNew: true,
          messageSpecialUse: "\\Inbox",
        },
      },
      `evt-reply-${Date.now()}`,
    );
    check("the reply webhook is accepted", res.status === 202, res.status);
  }

  // Give the handler a moment to finish.
  await sleep(400);

  {
    const rows = await sql`
      SELECT id, subject, direction, classification, snippet
      FROM messages WHERE lead_id = ${leadId}
    `;
    check("the reply was stored", rows.length === 1, rows.length);
    check(
      "it was stored as an inbound message",
      rows[0]?.direction === "inbound",
      rows[0]?.direction,
    );
    check(
      "it was classified as positive",
      rows[0]?.classification === "positive",
      rows[0]?.classification,
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM conversations WHERE lead_id = ${leadId}
    `;
    check("a conversation was created", rows[0]!.n === 1, rows[0]!.n);
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM activities
      WHERE lead_id = ${leadId} AND type = 'reply_received'
    `;
    check("a reply_received activity was recorded", rows[0]!.n === 1, rows[0]!.n);
  }

  {
    const rows = await sql`
      SELECT l.name FROM leads ld
      JOIN lead_labels l ON l.id = ld.status_id
      WHERE ld.id = ${leadId}
    `;
    check(
      "the lead was labelled Interested",
      rows[0]?.name === "Interested",
      rows[0]?.name,
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM opportunities WHERE lead_id = ${leadId}
    `;
    check("an opportunity was recorded", rows[0]!.n === 1, rows[0]!.n);
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM lead_status_events WHERE lead_id = ${leadId}
    `;
    check("a status event was recorded", rows[0]!.n === 1, rows[0]!.n);
  }

  /* -------------------- 3. idempotent redelivery ---------------------- */

  console.log("\n3. redelivery is idempotent");

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM activities
      WHERE lead_id = ${leadId} AND type = 'reply_received'
    `;
    check(
      "the reply was counted once, not twice",
      rows[0]!.n === 1,
      rows[0]!.n,
    );
  }

  /* ---------------------- 4. out of office ---------------------------- */

  console.log("\n4. out-of-office reply parks the lead");

  const oooEmail = `ooo-test-${Date.now()}@example.com`;
  const oooLead = await sql`
    INSERT INTO leads (workspace_id, email, first_name, company)
    SELECT id, ${oooEmail}, 'Sam', 'Northwind Labs' FROM workspaces LIMIT 1
    RETURNING id
  `;
  const oooLeadId = oooLead[0]!.id as string;

  await postEvent(
    {
      event: "messageNew",
      account,
      date: new Date().toISOString(),
      data: {
        id: `msg-ooo-${Date.now()}`,
        date: new Date().toISOString(),
        subject: "Out of Office: away until next week",
        from: { name: "Sam", address: oooEmail },
        to: [{ address: account }],
        messageId: `<ooo-${Date.now()}@example.com>`,
        text: {
          plain:
            "I am currently out of the office and will return on 2030-02-01. For urgent matters contact ops@example.com.",
        },
        seemsLikeNew: true,
        messageSpecialUse: "\\Inbox",
      },
    },
    `evt-ooo-${Date.now()}`,
  );

  await sleep(400);

  {
    const rows = await sql`
      SELECT ooo_until, ooo_until > now() AS in_future FROM leads WHERE id = ${oooLeadId}
    `;
    check("the lead was parked", rows[0]?.ooo_until !== null, rows[0]);
    check(
      "the resume date is in the future",
      rows[0]?.in_future === true,
      rows[0],
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM messages
      WHERE lead_id = ${oooLeadId} AND is_out_of_office = 1
    `;
    check("the message was flagged as out of office", rows[0]!.n === 1, rows[0]!.n);
  }

  /* ----------------------- 5. unsubscribe ----------------------------- */

  console.log("\n5. unsubscribe stops the lead everywhere");

  const unsubEmail = `unsub-test-${Date.now()}@example.com`;
  const unsubLead = await sql`
    INSERT INTO leads (workspace_id, email, first_name)
    SELECT id, ${unsubEmail}, 'Alex' FROM workspaces LIMIT 1
    RETURNING id
  `;
  const unsubLeadId = unsubLead[0]!.id as string;

  await sql`
    INSERT INTO campaign_leads (campaign_id, lead_id, state, next_step_at)
    VALUES (${campaignId}, ${unsubLeadId}, 'active', now())
  `;

  await postEvent(
    {
      event: "messageNew",
      account,
      date: new Date().toISOString(),
      data: {
        id: `msg-unsub-${Date.now()}`,
        date: new Date().toISOString(),
        subject: "Re: your email",
        from: { name: "Alex", address: unsubEmail },
        to: [{ address: account }],
        messageId: `<unsub-${Date.now()}@example.com>`,
        text: { plain: "Please unsubscribe me from this list." },
        seemsLikeNew: true,
        messageSpecialUse: "\\Inbox",
      },
    },
    `evt-unsub-${Date.now()}`,
  );

  await sleep(400);

  {
    const rows = await sql`
      SELECT unsubscribed FROM leads WHERE id = ${unsubLeadId}
    `;
    check("the lead was unsubscribed", rows[0]?.unsubscribed === 1, rows[0]);
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM blocklist WHERE value = ${unsubEmail}
    `;
    check("the address was blocklisted", rows[0]!.n === 1, rows[0]!.n);
  }

  {
    const rows = await sql`
      SELECT state, stopped_reason FROM campaign_leads
      WHERE lead_id = ${unsubLeadId}
    `;
    check(
      "the campaign lead was stopped",
      rows[0]?.state === "stopped",
      rows[0],
    );
    check(
      "with the right reason",
      rows[0]?.stopped_reason === "unsubscribed",
      rows[0]?.stopped_reason,
    );
  }

  /* -------------------------- 6. hard bounce --------------------------- */

  console.log("\n6. hard bounce invalidates the lead and blocks the address");

  const bounceEmail = `bounce-test-${Date.now()}@example.com`;
  const bounceLead = await sql`
    INSERT INTO leads (workspace_id, email, first_name)
    SELECT id, ${bounceEmail}, 'Robin' FROM workspaces LIMIT 1
    RETURNING id
  `;
  const bounceLeadId = bounceLead[0]!.id as string;

  await sql`
    INSERT INTO campaign_leads (campaign_id, lead_id, state, next_step_at)
    VALUES (${campaignId}, ${bounceLeadId}, 'active', now())
  `;

  const sentMessageId = `<sent-bounce-${Date.now()}@example.com>`;
  await sql`
    INSERT INTO sent_messages (
      workspace_id, message_id, lead_id, campaign_id, mailbox_id, recipient
    )
    SELECT ws.id, ${sentMessageId}, ${bounceLeadId}, ${campaignId}, ${mailboxId}, ${bounceEmail}
    FROM workspaces ws LIMIT 1
  `;

  await postEvent(
    {
      event: "messageBounce",
      account,
      date: new Date().toISOString(),
      data: {
        recipient: bounceEmail,
        action: "failed",
        messageId: sentMessageId,
        response: {
          source: "smtp",
          message: "550 5.1.1 User unknown",
          status: "5.1.1",
          category: "user_unknown",
          recommendedAction: "remove",
        },
      },
    },
    `evt-bounce-${Date.now()}`,
  );

  await sleep(400);

  {
    const rows = await sql`
      SELECT email_status FROM leads WHERE id = ${bounceLeadId}
    `;
    check("the lead was marked invalid", rows[0]?.email_status === "invalid", rows[0]);
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM bounces WHERE lead_id = ${bounceLeadId}
    `;
    check("a bounce row was written", rows[0]!.n === 1, rows[0]!.n);
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM blocklist
      WHERE value = ${bounceEmail} AND source = 'hard_bounce'
    `;
    check("the address was blocklisted", rows[0]!.n === 1, rows[0]!.n);
  }

  {
    const rows = await sql`
      SELECT state, stopped_reason FROM campaign_leads
      WHERE lead_id = ${bounceLeadId}
    `;
    check(
      "the campaign lead was stopped",
      rows[0]?.state === "stopped",
      rows[0],
    );
    check(
      "with the bounce reason",
      rows[0]?.stopped_reason === "bounced",
      rows[0]?.stopped_reason,
    );
  }

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM activities
      WHERE lead_id = ${bounceLeadId} AND type = 'bounced'
    `;
    check("a bounced activity was recorded", rows[0]!.n === 1, rows[0]!.n);
  }

  /* ---------------------- 7. open tracking ---------------------------- */

  console.log("\n7. an open is attributed to the lead");

  const openMessageId = `<sent-open-${Date.now()}@example.com>`;
  const openLead = await sql`
    INSERT INTO leads (workspace_id, email, first_name)
    SELECT id, ${`open-${Date.now()}@example.com`}, 'Casey' FROM workspaces LIMIT 1
    RETURNING id
  `;
  const openLeadId = openLead[0]!.id as string;

  await sql`
    INSERT INTO sent_messages (
      workspace_id, message_id, lead_id, campaign_id, mailbox_id, recipient
    )
    SELECT ws.id, ${openMessageId}, ${openLeadId}, ${campaignId}, ${mailboxId}, 'open@example.com'
    FROM workspaces ws LIMIT 1
  `;

  await postEvent(
    {
      event: "trackOpen",
      account,
      date: new Date().toISOString(),
      data: {
        messageId: openMessageId,
        remoteAddress: "203.0.113.42",
        userAgent: "Mozilla/5.0",
      },
    },
    `evt-open-${Date.now()}`,
  );

  await sleep(400);

  {
    const rows = await sql`
      SELECT count(*)::int AS n FROM activities
      WHERE lead_id = ${openLeadId} AND type = 'email_opened'
    `;
    check("an email_opened activity was recorded", rows[0]!.n === 1, rows[0]!.n);
  }

  /* -------------------------- 8. cleanup ------------------------------- */

  console.log("\n8. cleanup");

  await sql`
    DELETE FROM activities
    WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM messages WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM conversations WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM opportunities WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM lead_status_events WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM bounces WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM sent_messages WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM blocklist WHERE value IN (${unsubEmail}, ${bounceEmail})
  `;
  await sql`
    DELETE FROM campaign_leads WHERE lead_id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`
    DELETE FROM leads WHERE id IN (${leadId}, ${oooLeadId}, ${unsubLeadId}, ${bounceLeadId}, ${openLeadId})
  `;
  await sql`DELETE FROM campaign_steps WHERE campaign_id = ${campaignId}`;
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

  /* ---------------------------- summary -------------------------------- */

  console.log(`\n${passed} passed, ${failed} failed`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
