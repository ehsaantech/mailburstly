import { afterEach, describe, expect, test } from "bun:test";

import { submitMessage } from "./emailengine";

const realFetch = globalThis.fetch;

interface Captured {
  url: string;
  payload: Record<string, unknown>;
}

/** Replaces fetch with a stub that records what was sent. */
function capture(
  response: { status?: number; body?: unknown } = {},
): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      payload: JSON.parse(String(init.body ?? "{}")),
    });
    return new Response(
      JSON.stringify(response.body ?? { messageId: "<sent@example.com>" }),
      {
        status: response.status ?? 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("submitMessage", () => {
  test("addresses the account and the recipient the way EmailEngine wants", async () => {
    const calls = capture();

    await submitMessage("aitchkhan@gmail.com", {
      to: "lead@example.com",
      subject: "Re: a question",
      text: "sure",
    });

    expect(calls[0]!.url).toContain("/v1/account/aitchkhan%40gmail.com/submit");
    expect(calls[0]!.payload.to).toEqual([{ address: "lead@example.com" }]);
    expect(calls[0]!.payload.subject).toBe("Re: a question");
  });

  test("threads a reply with `reference`, never with an `inReplyTo` field", async () => {
    const calls = capture();

    await submitMessage("aitchkhan@gmail.com", {
      to: "lead@example.com",
      subject: "Re: a question",
      text: "sure",
      inReplyTo: "AAAAAQAB9M4",
    });

    const payload = calls[0]!.payload;
    // EmailEngine's submit payload has no `inReplyTo` field: sending one
    // fails the whole request with 400 "Invalid input".
    expect(payload.inReplyTo).toBeUndefined();
    expect(payload.reference).toEqual({
      message: "AAAAAQAB9M4",
      action: "reply",
      ignoreMissing: true,
    });
  });

  test("writes an RFC Message-ID parent into the headers", async () => {
    const calls = capture();

    await submitMessage("aitchkhan@gmail.com", {
      to: "lead@example.com",
      subject: "Re: a question",
      text: "sure",
      inReplyTo: "<abc123@mail.gmail.com>",
    });

    const payload = calls[0]!.payload;
    expect(payload.reference).toBeUndefined();
    expect(payload.headers).toEqual({
      "In-Reply-To": "<abc123@mail.gmail.com>",
      References: "<abc123@mail.gmail.com>",
    });
  });

  test("sends no threading fields for a first message", async () => {
    const calls = capture();

    await submitMessage("aitchkhan@gmail.com", {
      to: "lead@example.com",
      subject: "a question",
      text: "hello",
    });

    expect(calls[0]!.payload.reference).toBeUndefined();
    expect(calls[0]!.payload.headers).toBeUndefined();
  });

  test("names the refused field when EmailEngine rejects the payload", async () => {
    capture({
      status: 400,
      body: {
        statusCode: 400,
        error: "Bad Request",
        message: "Invalid input",
        fields: [{ message: '"inReplyTo" is not allowed', key: "inReplyTo" }],
      },
    });

    await expect(
      submitMessage("aitchkhan@gmail.com", {
        to: "lead@example.com",
        subject: "Re: a question",
        text: "sure",
      }),
    ).rejects.toThrow(/"inReplyTo" is not allowed/);
  });
});
