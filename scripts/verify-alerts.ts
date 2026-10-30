/**
 * End-to-end check of the alerting path.
 *
 * Sends a real alert through Resend and reports whether it went out. This
 * proves three things at once: the api key is good, the sending domain is
 * verified, and the alert renders and delivers.
 *
 *   bun run scripts/verify-alerts.ts
 *
 * The test alert goes to TEST_RECIPIENT, which defaults to
 * haroon@yopmail.com — the only sanctioned sink for a test send. The live
 * list of recipients lives in the database and is not touched by this
 * script.
 */

import {
  createAlerter,
  createResendTransport,
  type AlertRecipient,
} from "../packages/shared/src/index.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM = process.env.ALERT_FROM_EMAIL ?? "alerts@mail.ehsaanlabs.com";
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

console.log("verifying the alerting path");

check("RESEND_API_KEY is set", RESEND_API_KEY.length > 0);
if (RESEND_API_KEY.length === 0) {
  console.log("\n  no key — nothing to verify");
  process.exit(1);
}

check("a sending address is set", FROM.includes("@"), FROM);

const sent: string[] = [];

const transport = createResendTransport({
  apiKey: RESEND_API_KEY,
  from: FROM,
  timeoutMs: 15_000,
});

const alerter = createAlerter({
  transport: {
    async send(message) {
      sent.push(message.subject);
      await transport.send(message);
    },
  },
  resolveRecipients: async (): Promise<AlertRecipient[]> => [
    { email: RECIPIENT, name: "verify script", severity: "error" },
  ],
  service: "verify",
  onError: (error) => console.error("  alert error:", error),
});

const delivered = await alerter.alertNow({
  key: "verify.alerts",
  title: "Mailrung alerting check",
  message:
    "This is a test of the alerting path. If you are reading it, the sender, the api key and this address all work.",
  severity: "error",
  service: "verify",
  to: [RECIPIENT],
});

check("the alert was handed to resend", delivered);
check("one message was rendered", sent.length === 1, sent);

console.log(`\n  sent to: ${RECIPIENT}`);
console.log(`  from:    ${FROM}`);
console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);
