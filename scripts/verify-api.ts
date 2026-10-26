/**
 * Verifies the api surface added for M4 (inbox) and M5 (analytics).
 *
 * Runs against the live stack:
 *
 *   bun run scripts/verify-api.ts
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";
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
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...headers,
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
  /* ------------------------------- auth ------------------------------- */

  console.log("\n1. authentication");

  {
    const res = await call("GET", "/api/campaigns");
    check("an unauthenticated request is rejected", res.status === 401, res.status);
  }

  {
    const res = await call("POST", "/api/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    check("login succeeds", res.status === 200, res.status);
  }

  /* ------------------------------ inbox ------------------------------- */

  console.log("\n2. inbox");

  {
    const res = await call("GET", "/api/inbox/conversations");
    check(
      "conversations are listed",
      res.status === 200 && Array.isArray(res.json?.data?.items),
      res.status,
    );
  }

  {
    const res = await call("GET", "/api/inbox/conversations/not-a-uuid");
    check("a bad id is a 400", res.status === 400, res.status);
  }

  {
    const res = await call("GET", "/api/inbox/opportunities");
    check(
      "opportunities are listed",
      res.status === 200 && Array.isArray(res.json?.data?.items),
      res.status,
    );
  }

  {
    const res = await call("GET", "/api/inbox/labels");
    const items = res.json?.data?.items ?? [];
    check(
      "the nine built-in statuses are there",
      res.status === 200 && items.length >= 9,
      items.length,
    );
  }

  {
    const res = await call(
      "GET",
      "/api/inbox/conversations/00000000-0000-0000-0000-000000000000",
    );
    check("a missing conversation is a 404", res.status === 404, res.status);
  }

  /* ---------------------------- analytics ----------------------------- */

  console.log("\n3. analytics");

  {
    const res = await call("GET", "/api/analytics/overview");
    check("the overview loads", res.status === 200, res.status);
    check(
      "it carries totals",
      typeof res.json?.data?.totals?.sent === "number",
      res.json?.data?.totals,
    );
    check(
      "it carries a daily series",
      Array.isArray(res.json?.data?.series),
      res.json?.data?.series,
    );
    check(
      "it carries a campaign leaderboard",
      Array.isArray(res.json?.data?.leaderboard),
      res.json?.data?.leaderboard,
    );
  }

  {
    const res = await call("GET", "/api/analytics/overview?from=nonsense");
    check("a bad date is a 400", res.status === 400, res.status);
  }

  {
    const res = await call("GET", "/api/analytics/daily");
    check("the daily table loads", res.status === 200, res.status);
  }

  {
    const res = await call(
      "GET",
      "/api/analytics/campaigns/00000000-0000-0000-0000-000000000000",
    );
    check("a missing campaign is a 404", res.status === 404, res.status);
  }

  /* ---------------------------- webhooks ------------------------------ */

  console.log("\n4. outbound webhooks");

  let webhookId = "";

  {
    const res = await call("POST", "/api/webhooks", {
      name: "verify script",
      url: "http://localhost:9999/hook",
      events: ["email_sent"],
    });
    check("a webhook is created", res.status === 201, res.status);
    check(
      "the secret is returned once",
      typeof res.json?.data?.webhook?.secret === "string" &&
        res.json.data.webhook.secret.length > 20,
      res.json?.data?.webhook?.secret,
    );
    webhookId = res.json?.data?.webhook?.id ?? "";
  }

  {
    const res = await call("GET", "/api/webhooks");
    check("webhooks are listed", res.status === 200, res.status);
    const hook = (res.json?.data?.items ?? []).find(
      (w: any) => w.id === webhookId,
    );
    check(
      "the listed secret is masked",
      hook && hook.secret.includes("…"),
      hook?.secret,
    );
  }

  {
    const res = await call("PATCH", `/api/webhooks/${webhookId}`, {
      name: "verify script renamed",
    });
    check("a webhook is updated", res.status === 200, res.status);
  }

  {
    const res = await call("GET", "/api/webhooks/deliveries");
    check("deliveries are listed", res.status === 200, res.status);
  }

  /* ---------------------------- api keys ------------------------------ */

  console.log("\n5. api keys and the public api");

  let rawKey = "";

  {
    const res = await call("POST", "/api/webhooks/api-keys", {
      name: "verify script",
    });
    check("an api key is created", res.status === 201, res.status);
    rawKey = res.json?.data?.apiKey?.key ?? "";
    check(
      "the raw key is returned once",
      rawKey.startsWith("mrk_"),
      rawKey.slice(0, 8),
    );
  }

  {
    const res = await call("GET", "/api/public/v1/campaigns", undefined, {
      authorization: `Bearer ${rawKey}`,
    });
    check(
      "the public api accepts the key",
      res.status === 200 && Array.isArray(res.json?.data),
      res.status,
    );
  }

  {
    const res = await call("GET", "/api/public/v1/leads", undefined, {
      authorization: "Bearer mrk_not-a-real-key",
    });
    check("a bad key is a 401", res.status === 401, res.status);
  }

  {
    const res = await call("GET", "/api/public/v1/campaigns");
    check("the public api needs a key", res.status === 401, res.status);
  }

  {
    const res = await call("GET", "/api/public/v1/leads", undefined, {
      authorization: `Bearer ${rawKey}`,
    });
    check("the public api lists leads", res.status === 200, res.status);
  }

  /* -------------------------- subsequences ---------------------------- */

  console.log("\n6. subsequences");

  let campaignId = "";
  let sequenceId = "";

  {
    const res = await call("POST", "/api/campaigns", {
      name: "Subsequence verify",
    });
    check("a campaign is created", res.status === 201, res.status);
    campaignId = res.json?.data?.campaign?.id ?? "";
  }

  {
    const res = await call("POST", "/api/subsequences", {
      campaignId,
      name: "Booked a call",
      trigger: "reply",
      steps: [
        { subject: "Great", bodyHtml: "<p>Great, here is the link.</p>", delayMinutes: 0 },
        { subject: "Following up", bodyHtml: "<p>Still around?</p>", delayMinutes: 1440 },
      ],
    });
    check("a subsequence is created", res.status === 201, res.status);
    check(
      "it has two steps",
      (res.json?.data?.subsequence?.steps ?? []).length === 2,
      res.json?.data?.subsequence?.steps?.length,
    );
    sequenceId = res.json?.data?.subsequence?.id ?? "";
  }

  {
    const res = await call("GET", `/api/subsequences?campaignId=${campaignId}`);
    check("subsequences are listed", res.status === 200, res.status);
  }

  {
    const res = await call("POST", `/api/subsequences/${sequenceId}/steps`, {
      subject: "Third",
      bodyHtml: "<p>Third step.</p>",
      delayMinutes: 0,
    });
    check("a step is added", res.status === 201, res.status);
  }

  {
    const res = await call("GET", `/api/subsequences/${sequenceId}`);
    check(
      "the sequence now has three steps",
      (res.json?.data?.subsequence?.steps ?? []).length === 3,
      res.json?.data?.subsequence?.steps?.length,
    );
  }

  {
    const res = await call("DELETE", `/api/subsequences/${sequenceId}`);
    check("a subsequence is deleted", res.status === 204, res.status);
  }

  /* --------------------------- campaigns ------------------------------ */

  console.log("\n7. campaigns and cleanup");

  {
    const res = await call("GET", `/api/campaigns/${campaignId}`);
    check("the campaign is readable", res.status === 200, res.status);
  }

  {
    const res = await call("DELETE", `/api/campaigns/${campaignId}`);
    check("the campaign is deleted", res.status === 204, res.status);
  }

  {
    const res = await call("DELETE", `/api/webhooks/${webhookId}`);
    check("the webhook is deleted", res.status === 204, res.status);
  }

  {
    const rows = await sql`SELECT id FROM api_keys WHERE name = 'verify script'`;
    for (const row of rows) {
      await sql`DELETE FROM api_keys WHERE id = ${row.id}`;
    }
    check("the api key is removed from the database", rows.length >= 1, rows.length);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

await main();
