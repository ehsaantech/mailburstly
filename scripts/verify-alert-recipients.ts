/**
 * End-to-end check of the alert recipient management.
 *
 * Logs in as the operator, reads the list of recipients, adds the
 * sanctioned test sink, sends a real test alert through Resend to it, and
 * removes it again.
 *
 *   bun run scripts/verify-alert-recipients.ts
 *
 * The test alert goes to TEST_RECIPIENT, which defaults to
 * haroon@yopmail.com — the only sanctioned sink for a test send. The
 * operator's own addresses are never used for a test, and the list is
 * restored to how it was found.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-admin-password";

/**
 * Where the test alert goes.
 *
 * The only sanctioned sink for a test send. A send to a made-up address
 * proves nothing, because it bounces before it is read, and a send to a
 * real contact reaches a stranger without the operator asking for it.
 */
const RECIPIENT = (process.env.TEST_RECIPIENT ?? "haroon@yopmail.com").trim();

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

interface Recipient {
  id: string;
  email: string;
  name: string | null;
  severity: "error" | "warning";
  enabled: boolean;
}

async function main() {
  console.log("\n1. sign in");

  {
    const res = await call("POST", "/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    check("the operator can sign in", res.status === 200, res.json);
    if (res.status !== 200) {
      console.log("\n  cannot continue without a session");
      process.exit(1);
    }
  }

  console.log("\n2. read the recipients");

  const before = await call("GET", "/alert-recipients");
  check("the list is readable", before.status === 200, before.json);
  const items: Recipient[] = before.json?.data?.items ?? [];
  check("the list has at least one recipient", items.length > 0, items);

  console.log("\n3. add the test sink");

  // The sink may already be on the list — from an earlier run, or because
  // the operator put it there. Either way it is used, and only an address
  // this script added is removed again.
  const existing = items.find((r) => r.email === RECIPIENT);

  let created: Recipient | undefined = existing;

  if (!existing) {
    const added = await call("POST", "/alert-recipients", {
      email: RECIPIENT,
      name: "verify script",
      severity: "error",
    });
    check("the test recipient can be added", added.status === 201, added.json);
    created = added.json?.data?.recipient;
  } else {
    check("the test recipient was already on the list", true);
  }

  if (!created) {
    console.log("\n  cannot continue without the recipient");
    process.exit(1);
  }

  console.log("\n4. duplicate handling");

  const duplicate = await call("POST", "/alert-recipients", {
    email: RECIPIENT,
  });
  check("the same address cannot be added twice", duplicate.status === 409, {
    status: duplicate.status,
  });

  console.log("\n5. update it");

  const patched = await call("PATCH", `/alert-recipients/${created.id}`, {
    severity: "warning",
    enabled: false,
  });
  check("the recipient can be updated", patched.status === 200, patched.json);
  check(
    "the change is stored",
    patched.json?.data?.recipient?.severity === "warning" &&
      patched.json?.data?.recipient?.enabled === false,
    patched.json?.data?.recipient,
  );

  console.log("\n6. send a test alert");

  const tested = await call("POST", `/alert-recipients/${created.id}/test`);
  check("the test alert was delivered", tested.status === 200, tested.json);
  check(
    "resend accepted it",
    tested.json?.data?.delivered === true,
    tested.json?.data,
  );

  console.log("\n7. leave the list as it was found");

  if (existing) {
    // Put it back the way it was.
    const restored = await call("PATCH", `/alert-recipients/${created.id}`, {
      severity: existing.severity,
      enabled: existing.enabled,
      name: existing.name,
    });
    check("the recipient was restored", restored.status === 200, restored.json);
  } else {
    const removed = await call("DELETE", `/alert-recipients/${created.id}`);
    check("the recipient can be removed", removed.status === 204, removed.status);
  }

  const after = await call("GET", "/alert-recipients");
  const afterItems: Recipient[] = after.json?.data?.items ?? [];
  check(
    "the list is back to how it was",
    afterItems.length === items.length,
    afterItems.map((r) => r.email),
  );

  console.log(`\n  test alert went to: ${RECIPIENT}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
