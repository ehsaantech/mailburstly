/**
 * Checks that a campaign send carries a working one-click unsubscribe link.
 *
 * The campaign sends from one Spaceship mailbox to another — both ours, so
 * the delivered message can be read back over IMAP and its headers checked.
 * The link in the header is then followed, and the lead has to come out
 * unsubscribed and blocklisted.
 */
import { ImapFlow } from "../apps/mailcore/node_modules/imapflow";

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-admin-password";

/** The mailbox the campaign sends from. */
const FROM = process.env.TEST_FROM ?? "haroon@theehsaantech.com";
/** The mailbox the campaign sends to — ours, so we can read the result. */
const TO = process.env.TEST_TO ?? "harooon@theehsaantech.com";
const PASSWORD =
  process.env.TEST_MAILBOX_PASSWORD ?? "Ehsaan-karo-so-ehsaan-kia-ja-sake-3##";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    if (detail !== undefined) console.log(`       ${JSON.stringify(detail)}`);
  }
}

let cookie = "";
async function call(method: string, path: string, body?: unknown) {
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
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const { default: postgres } = await import(
  "../packages/db/node_modules/postgres/src/index.js"
);
const sql = postgres(
  process.env.DATABASE_URL ??
    "postgres://mailrung:change-me-postgres@localhost:5433/mailrung",
  { max: 1 },
);

async function main() {
  const stamp = Date.now();
  let campaignId = "";
  let leadId = "";
  let leadCreated = false;

  await call("POST", "/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });

  const existing = await sql`
    SELECT id FROM leads WHERE lower(email) = lower(${TO}) LIMIT 1`;
  if (existing.length > 0) {
    leadId = existing[0]!.id as string;
  } else {
    const res = await call("POST", "/leads", {
      email: TO,
      firstName: "Unsubscribe",
      lastName: "Probe",
    });
    leadId = res.json?.data?.lead?.id ?? "";
    leadCreated = true;
  }

  const created = await call("POST", "/campaigns", {
    name: `Unsubscribe check ${stamp}`,
    emailGapMinutes: 1,
    randomWaitMax: 0,
    insertUnsubscribeHeader: true,
  });
  campaignId = created.json?.data?.campaign?.id ?? "";

  await call("POST", `/campaigns/${campaignId}/steps`, {
    subject: `Unsubscribe probe ${stamp}`,
    bodyHtml: "This is a one-click unsubscribe probe.",
    delayMinutes: 0,
  });
  await call("POST", `/campaigns/${campaignId}/leads`, { leadIds: [leadId] });

  const mailbox = await sql`
    SELECT id FROM mailboxes WHERE lower(email) = lower(${FROM}) LIMIT 1`;
  if (mailbox.length > 0) {
    await call("POST", `/campaigns/${campaignId}/mailboxes`, {
      mailboxIds: [mailbox[0]!.id],
    });
  }

  await call("POST", `/campaigns/${campaignId}/launch`);

  console.log("\nwaiting for the send");
  const deadline = Date.now() + 120_000;
  let sent = false;
  while (Date.now() < deadline) {
    const rows = await sql`
      SELECT sj.state FROM send_jobs sj
      JOIN campaign_leads cl ON cl.id = sj.campaign_lead_id
      WHERE cl.campaign_id = ${campaignId} AND sj.state IN ('sent','failed','skipped')
      ORDER BY sj.created_at DESC LIMIT 1`;
    if (rows.length > 0) {
      sent = rows[0]!.state === "sent";
      check("the campaign send succeeded", sent, rows[0]!.state);
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!sent) check("the campaign send succeeded", false, "timed out");

  console.log("\nreading the delivered message over IMAP");
  // The message is delivered by the receiving server's MTA, so it can be a
  // few seconds behind the send that produced it. Poll for it rather than
  // reading once and declaring failure.
  const client = new ImapFlow({
    host: "mail.spacemail.com",
    port: 993,
    secure: true,
    auth: { user: TO, pass: PASSWORD },
    logger: false,
  });
  await client.connect();
  let header: string | null = null;
  let post: string | null = null;
  const deadline2 = Date.now() + 120_000;
  while (Date.now() < deadline2 && header === null) {
    const lock = await client.getMailboxLock("INBOX");
    for await (const m of client.fetch({}, { source: true, uid: true })) {
      if (!m.source) continue;
      const raw = m.source.toString();
      if (!raw.includes(`Unsubscribe probe ${stamp}`)) continue;
      const head = raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, " ");
      header =
        head.split(/\r?\n/).find((l) => /^list-unsubscribe:/i.test(l)) ?? null;
      post =
        head.split(/\r?\n/).find((l) => /^list-unsubscribe-post:/i.test(l)) ?? null;
      break;
    }
    await lock.release();
    if (header === null) await new Promise((r) => setTimeout(r, 3000));
  }
  await client.logout();

  check("the delivered message has a List-Unsubscribe header", header !== null, header);
  check(
    "the header carries the one-click POST directive",
    !!post && /list-unsubscribe=one-click/i.test(post),
    post,
  );

  const url = /<([^>]+)>/.exec(header ?? "")?.[1] ?? "";
  check("the header carries a URL", url.startsWith("http"), url);
  check("the URL points at the unsubscribe route", /\/u\//.test(url), url);

  if (!url) {
    console.log("\nno URL to follow");
    console.log(`\n${passed} passed, ${failed} failed`);
    await sql.end();
    process.exit(1);
  }

  console.log("\nfollowing the link");
  const res = await fetch(url, { method: "POST" });
  check("the one-click POST is accepted", res.status === 200, res.status);

  await new Promise((r) => setTimeout(r, 5000));
  const lead = await sql`SELECT unsubscribed FROM leads WHERE id = ${leadId}`;
  check("the lead is marked unsubscribed", lead[0]?.unsubscribed === 1, lead[0]);
  const blocked = await sql`
    SELECT count(*)::int AS n FROM blocklist
    WHERE value = ${TO} AND source = 'unsubscribe'`;
  check("the address is blocklisted", (blocked[0]?.n ?? 0) > 0, blocked[0]);

  console.log("\ncleanup");
  await sql`DELETE FROM activities WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM sent_messages WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM campaign_leads WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
  await sql`DELETE FROM blocklist WHERE value = ${TO} AND source = 'unsubscribe'`;
  if (leadCreated) await sql`DELETE FROM leads WHERE id = ${leadId}`;
  else await sql`UPDATE leads SET unsubscribed = 0 WHERE id = ${leadId}`;
  console.log("  ok   test data removed");

  console.log(`\n${passed} passed, ${failed} failed`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

await main();
