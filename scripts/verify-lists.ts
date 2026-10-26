/**
 * Verifies lead lists: creation, membership, duplication, deletion, and the
 * campaign attachment that turns a list into a campaign's audience.
 *
 *   bun run scripts/verify-lists.ts
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
  const listName = `Verify list ${stamp}`;

  /* ------------------------------ create ------------------------------- */

  console.log("\n2. create a list");

  let listId = "";
  {
    const res = await call("POST", "/lists", {
      name: listName,
      description: "A list for the verification run",
    });
    check("the list is created", res.status === 201, res.status);
    listId = res.json?.data?.list?.id ?? "";
  }

  {
    const res = await call("POST", "/lists", { name: listName });
    check("a duplicate name is a 409", res.status === 409, res.status);
  }

  {
    const res = await call("POST", "/lists", { name: "" });
    check("an empty name is a 400", res.status === 400, res.status);
  }

  {
    const res = await call("GET", "/lists");
    check("the lists are listed", res.status === 200, res.status);
    const items = res.json?.data?.items ?? [];
    check(
      "the list is there",
      items.some((l: any) => l.id === listId),
    );
    check(
      "it starts empty",
      items.find((l: any) => l.id === listId)?.memberCount === 0,
      items.find((l: any) => l.id === listId)?.memberCount,
    );
  }

  /* ----------------------------- members ------------------------------- */

  console.log("\n3. members");

  const leadEmails: string[] = [];
  const leadIds: string[] = [];

  for (let i = 0; i < 3; i++) {
    const email = `list-verify-${stamp}-${i}@example.com`;
    const res = await call("POST", "/leads", {
      email,
      firstName: `Lead${i}`,
      lastName: "Tester",
      company: "Northwind",
    });
    leadEmails.push(email);
    leadIds.push(res.json?.data?.lead?.id ?? "");
  }
  check("three leads were created", leadIds.every(Boolean), leadIds);

  {
    const res = await call("POST", `/lists/${listId}/members`, {
      leadIds,
    });
    check("the leads are added", res.status === 201, res.status);
    check("all three were added", res.json?.data?.added === 3, res.json?.data);
  }

  {
    const res = await call("POST", `/lists/${listId}/members`, {
      leadIds: [leadIds[0]],
    });
    check(
      "adding the same lead again is skipped, not duplicated",
      res.json?.data?.added === 0 && res.json?.data?.skipped === 1,
      res.json?.data,
    );
  }

  {
    const res = await call("GET", `/lists/${listId}/members`);
    check("the members are listed", res.status === 200, res.status);
    check(
      "there are three of them",
      (res.json?.data ?? []).length === 3,
      (res.json?.data ?? []).length,
    );
  }

  {
    const res = await call("GET", `/lists/${listId}/members?search=Lead1`);
    check(
      "the members can be searched",
      (res.json?.data ?? []).length === 1,
      (res.json?.data ?? []).length,
    );
  }

  {
    const res = await call("GET", "/lists");
    const list = (res.json?.data?.items ?? []).find(
      (l: any) => l.id === listId,
    );
    check("the count is right", list?.memberCount === 3, list?.memberCount);
  }

  {
    const res = await call("DELETE", `/lists/${listId}/members/${leadIds[0]}`);
    check("a member is removed", res.status === 204, res.status);
  }

  {
    const res = await call("GET", `/lists/${listId}/members`);
    check(
      "there are two left",
      (res.json?.data ?? []).length === 2,
      (res.json?.data ?? []).length,
    );
  }

  /* ---------------------------- duplicate ------------------------------ */

  console.log("\n4. duplicate");

  let copyId = "";
  {
    const res = await call("POST", `/lists/${listId}/duplicate`);
    check("the list is duplicated", res.status === 201, res.status);
    copyId = res.json?.data?.list?.id ?? "";
    check(
      "the copy has a free name",
      res.json?.data?.list?.name !== listName,
      res.json?.data?.list?.name,
    );
  }

  {
    const res = await call("GET", `/lists/${copyId}/members`);
    check(
      "the copy has the same members",
      (res.json?.data ?? []).length === 2,
      (res.json?.data ?? []).length,
    );
  }

  /* ------------------------- campaign attachment ----------------------- */

  console.log("\n5. attach the list to a campaign");

  const campaignRes = await call("POST", "/campaigns", {
    name: `List verify campaign ${stamp}`,
    schedule: {
      mode: "custom",
      rules: [
        { daysOfWeek: [], startTime: "00:00", endTime: "00:00", timezone: "UTC" },
      ],
    },
  });
  const campaignId = campaignRes.json?.data?.campaign?.id ?? "";
  check("the campaign is created", campaignRes.status === 201, campaignRes.status);

  {
    const res = await call("POST", `/lists/${listId}/campaigns`, { campaignId });
    check("the list is attached", res.status === 201, res.status);
    check(
      "its members are enrolled",
      res.json?.data?.enrolled === 2,
      res.json?.data,
    );
  }

  {
    const res = await call("GET", `/campaigns/${campaignId}/leads`);
    check(
      "the campaign now has the leads",
      (res.json?.data ?? []).length >= 2,
      (res.json?.data ?? []).length,
    );
  }

  {
    const res = await call("GET", `/lists/${listId}`);
    check(
      "the list knows its campaign",
      (res.json?.data?.list?.campaigns ?? []).length === 1,
      res.json?.data?.list?.campaigns,
    );
  }

  {
    // A lead added after the attach is enrolled too — but only once the
    // campaign is actually running.
    const launch = await call("POST", `/campaigns/${campaignId}/launch`);
    check("the campaign is launched", launch.status === 200, launch.status);

    const res = await call("POST", "/leads", {
      email: `list-verify-late-${stamp}@example.com`,
      firstName: "Late",
    });
    const lateId = res.json?.data?.lead?.id ?? "";

    const add = await call("POST", `/lists/${listId}/members`, {
      leadIds: [lateId],
    });
    check("the late lead is added", add.json?.data?.added === 1, add.json?.data);
    check(
      "and enrolled straight away",
      add.json?.data?.enrolled === 1,
      add.json?.data,
    );

    const campaignLeads = await call("GET", `/campaigns/${campaignId}/leads`);
    check(
      "the campaign has three leads now",
      (campaignLeads.json?.data ?? []).length === 3,
      (campaignLeads.json?.data ?? []).length,
    );

    await sql`DELETE FROM campaign_leads WHERE lead_id = ${lateId}`;
    await sql`DELETE FROM leads WHERE id = ${lateId}`;
  }

  {
    const res = await call("DELETE", `/lists/${listId}/campaigns/${campaignId}`);
    check("the list is detached", res.status === 204, res.status);
  }

  /* ----------------------------- delete ------------------------------- */

  console.log("\n6. delete the list");

  {
    const res = await call("DELETE", `/lists/${listId}`);
    check("the list is deleted", res.status === 204, res.status);
  }

  {
    // Deleting a list must never delete a lead.
    const rows = await sql`
      SELECT count(*)::int AS n FROM leads WHERE id IN ${sql(leadIds)}
    `;
    check(
      "the leads are still there",
      rows[0]!.n === leadIds.length,
      rows[0]!.n,
    );
  }

  {
    const res = await call("GET", `/lists/${listId}`);
    check("the list is gone", res.status === 404, res.status);
  }

  /* ------------------------------ cleanup ----------------------------- */

  console.log("\n7. cleanup");

  {
    await sql`DELETE FROM campaign_leads WHERE lead_id IN ${sql(leadIds)}`;
    await sql`DELETE FROM leads WHERE id IN ${sql(leadIds)}`;
    await sql`DELETE FROM campaign_steps WHERE campaign_id = ${campaignId}`;
    await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
    await sql`DELETE FROM lead_list_members WHERE list_id = ${copyId}`;
    await sql`DELETE FROM lead_lists WHERE id = ${copyId}`;

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
