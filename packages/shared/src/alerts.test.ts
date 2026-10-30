import { describe, expect, test } from "bun:test";

import {
  createAlerter,
  renderAlert,
  wantsSeverity,
  type AlertInput,
  type AlertMessage,
  type AlertRecipient,
} from "./alerts.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function recipients(
  ...list: Array<Partial<AlertRecipient> & { email: string }>
): AlertRecipient[] {
  return list.map((r) => ({
    name: null,
    severity: "error" as const,
    ...r,
  }));
}

/** A transport that records what it was asked to send. */
function recorder() {
  const sent: AlertMessage[] = [];
  return {
    sent,
    transport: {
      async send(message: AlertMessage) {
        sent.push(message);
      },
    },
  };
}

const failure: AlertInput = {
  key: "dispatcher.submit_failed",
  title: "Campaign email could not be sent",
  message: "The mail gateway refused the message.",
  context: { jobId: "abc", mailbox: "ops@example.com" },
};

/** A clock the test moves by hand. */
function clock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Severity filtering                                                           */
/* -------------------------------------------------------------------------- */

describe("wantsSeverity", () => {
  test("an error recipient hears about errors", () => {
    expect(
      wantsSeverity({ email: "a@b.com", severity: "error" }, "error"),
    ).toBe(true);
  });

  test("an error recipient does not hear about warnings", () => {
    expect(
      wantsSeverity({ email: "a@b.com", severity: "error" }, "warning"),
    ).toBe(false);
  });

  test("a warning recipient hears about everything", () => {
    expect(
      wantsSeverity({ email: "a@b.com", severity: "warning" }, "warning"),
    ).toBe(true);
    expect(
      wantsSeverity({ email: "a@b.com", severity: "warning" }, "error"),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Deduplication                                                                */
/* -------------------------------------------------------------------------- */

describe("createAlerter", () => {
  test("sends the first occurrence", async () => {
    const { sent, transport } = recorder();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
    });

    await alerter.alert(failure);

    expect(sent.length).toBe(1);
    expect(sent[0]!.to).toEqual(["ops@example.com"]);
    expect(sent[0]!.subject).toContain("ERROR");
    expect(sent[0]!.subject).toContain("Campaign email could not be sent");
  });

  test("collapses repeats inside the cooldown into one email", async () => {
    const { sent, transport } = recorder();
    const time = clock();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
      cooldownMs: 60_000,
      now: time.now,
    });

    await alerter.alert(failure);
    await alerter.alert(failure);
    await alerter.alert(failure);

    expect(sent.length).toBe(1);
  });

  test("reports how many times the repeats happened", async () => {
    const { sent, transport } = recorder();
    const time = clock();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
      cooldownMs: 60_000,
      now: time.now,
    });

    await alerter.alert(failure);
    await alerter.alert(failure);
    await alerter.alert(failure);
    time.advance(60_001);
    await alerter.alert(failure);

    expect(sent.length).toBe(2);
    expect(sent[1]!.text).toContain("2 more times");
  });

  test("different keys are alerted independently", async () => {
    const { sent, transport } = recorder();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
      cooldownMs: 60_000,
    });

    await alerter.alert(failure);
    await alerter.alert({ ...failure, key: "worker.aggregation_failed" });

    expect(sent.length).toBe(2);
  });

  test("stops at the hourly cap", async () => {
    const { sent, transport } = recorder();
    const time = clock();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
      cooldownMs: 1_000,
      maxAlertsPerHour: 3,
      now: time.now,
    });

    for (let i = 0; i < 10; i++) {
      await alerter.alert({ ...failure, key: `failure.${i}` });
      time.advance(2_000);
    }

    expect(sent.length).toBe(3);
  });

  test("does nothing when there is no transport", async () => {
    const alerter = createAlerter({
      transport: null,
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
    });

    expect(alerter.enabled).toBe(false);
    await alerter.alert(failure);
  });

  test("never throws when the transport fails", async () => {
    const errors: unknown[] = [];
    const alerter = createAlerter({
      transport: {
        async send() {
          throw new Error("resend is down");
        },
      },
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
      onError: (error) => errors.push(error),
    });

    await alerter.alert(failure);

    expect(errors.length).toBe(1);
  });

  test("never throws when the recipient lookup fails", async () => {
    const errors: unknown[] = [];
    const alerter = createAlerter({
      transport: {
        async send() {},
      },
      resolveRecipients: async () => {
        throw new Error("database is down");
      },
      onError: (error) => errors.push(error),
    });

    await alerter.alert(failure);

    expect(errors.length).toBe(1);
  });

  test("skips recipients that do not want this severity", async () => {
    const { sent, transport } = recorder();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () =>
        recipients(
          { email: "errors@example.com", severity: "error" },
          { email: "everything@example.com", severity: "warning" },
        ),
    });

    await alerter.alert({ ...failure, severity: "warning" });

    expect(sent.length).toBe(1);
    expect(sent[0]!.to).toEqual(["everything@example.com"]);
  });

  test("sends to every matching recipient", async () => {
    const { sent, transport } = recorder();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () =>
        recipients(
          { email: "one@example.com" },
          { email: "two@example.com" },
        ),
    });

    await alerter.alert(failure);

    expect(sent[0]!.to).toEqual(["one@example.com", "two@example.com"]);
  });

  test("a failure during an in-flight delivery does not send twice", async () => {
    const sent: AlertMessage[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const alerter = createAlerter({
      transport: {
        async send(message) {
          sent.push(message);
          await gate;
        },
      },
      resolveRecipients: async () => recipients({ email: "ops@example.com" }),
      cooldownMs: 60_000,
    });

    // The first delivery is still in flight when the next two arrive.
    const first = alerter.alert(failure);
    await alerter.alert(failure);
    await alerter.alert(failure);

    release();
    await first;

    expect(sent.length).toBe(1);
  });

  test("alertNow ignores the cooldown and the severity filter", async () => {
    const { sent, transport } = recorder();
    const alerter = createAlerter({
      transport,
      resolveRecipients: async () =>
        recipients({ email: "errors@example.com", severity: "error" }),
      cooldownMs: 600_000,
    });

    await alerter.alert(failure);
    const delivered = await alerter.alertNow({
      ...failure,
      severity: "warning",
      to: ["someone@example.com"],
    });

    expect(delivered).toBe(true);
    expect(sent.length).toBe(2);
    expect(sent[1]!.to).toEqual(["someone@example.com"]);
  });

  test("alertNow reports a failed delivery", async () => {
    const alerter = createAlerter({
      transport: {
        async send() {
          throw new Error("resend is down");
        },
      },
      resolveRecipients: async () => [],
    });

    const delivered = await alerter.alertNow({
      ...failure,
      to: ["someone@example.com"],
    });

    expect(delivered).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Rendering                                                                    */
/* -------------------------------------------------------------------------- */

describe("renderAlert", () => {
  test("escapes the values it puts in html", () => {
    const message = renderAlert(
      ["ops@example.com"],
      {
        key: "k",
        title: "<script>alert(1)</script>",
        message: "a & b",
      },
      0,
      "worker",
    );

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.text).toContain("<script>alert(1)</script>");
  });

  test("renders the context as details", () => {
    const message = renderAlert(
      ["ops@example.com"],
      { key: "k", title: "t", message: "m", context: { jobId: "abc" } },
      0,
      "dispatcher",
    );

    expect(message.html).toContain("jobId");
    expect(message.text).toContain("jobId: abc");
    expect(message.text).toContain("Service: dispatcher");
  });
});
