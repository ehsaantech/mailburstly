import { describe, expect, test } from "bun:test";

import {
  buildSnippet,
  classifyInterest,
  extractResumeDate,
  hasOpportunitySignal,
  isOutOfOffice,
  isUnsubscribeRequest,
} from "./classify";

const NOW = new Date("2026-01-05T10:00:00Z");

/* -------------------------------------------------------------------------- */
/* Out of office                                                               */
/* -------------------------------------------------------------------------- */

describe("isOutOfOffice", () => {
  test("recognises the common subject lines", () => {
    expect(isOutOfOffice("Out of Office", "")).toBe(true);
    expect(isOutOfOffice("Automatic reply: away", "")).toBe(true);
    expect(isOutOfOffice("OOO: back soon", "")).toBe(true);
    expect(isOutOfOffice("OOF", "")).toBe(true);
  });

  test("recognises a body-only out of office", () => {
    expect(isOutOfOffice("Re: your email", "I am currently out of the office")).toBe(true);
  });

  test("a normal reply is not an out of office", () => {
    expect(isOutOfOffice("Re: quick question", "Yes, I'd like to know more")).toBe(false);
  });

  test("handles missing subject and body", () => {
    expect(isOutOfOffice(null, null)).toBe(false);
    expect(isOutOfOffice(undefined, undefined)).toBe(false);
  });
});

describe("extractResumeDate", () => {
  test("reads an ISO date", () => {
    const date = extractResumeDate("OOO until 2026-02-10", "", NOW);
    expect(date).not.toBeNull();
    expect(date!.toISOString().slice(0, 10)).toBe("2026-02-10");
  });

  test("reads a named date", () => {
    const date = extractResumeDate("Back on March 5", "", NOW);
    expect(date).not.toBeNull();
    expect(date!.toISOString().slice(0, 10)).toBe("2026-03-05");
  });

  test("reads a day-first named date", () => {
    const date = extractResumeDate("I will be back on 12 March", "", NOW);
    expect(date).not.toBeNull();
    expect(date!.toISOString().slice(0, 10)).toBe("2026-03-12");
  });

  test("a date already in the past rolls to next year", () => {
    const date = extractResumeDate("Back on March 5", "", NOW);
    // March 2026 has not happened yet relative to 5 January 2026, so it
    // stays in this year.
    expect(date!.toISOString().slice(0, 4)).toBe("2026");
  });

  test("no date means the lead resumes on the next tick", () => {
    expect(extractResumeDate("Out of office", "I am away for a while", NOW)).toBeNull();
  });

  test("a past date is not a resume date", () => {
    expect(extractResumeDate("Back on 2020-01-01", "", NOW)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Unsubscribe                                                                 */
/* -------------------------------------------------------------------------- */

describe("isUnsubscribeRequest", () => {
  test("recognises the common phrasings", () => {
    expect(isUnsubscribeRequest("Unsubscribe", "")).toBe(true);
    expect(isUnsubscribeRequest("Re: your email", "please unsubscribe me")).toBe(true);
    expect(isUnsubscribeRequest("Opt out", "")).toBe(true);
    expect(isUnsubscribeRequest("Re: your email", "remove me from your list")).toBe(true);
    expect(isUnsubscribeRequest("Re: your email", "stop sending me emails")).toBe(true);
  });

  test("a normal reply is not an unsubscribe", () => {
    expect(isUnsubscribeRequest("Re: quick question", "I'm interested, let's talk")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Interest                                                                    */
/* -------------------------------------------------------------------------- */

describe("classifyInterest", () => {
  test("a buying signal is positive", () => {
    expect(classifyInterest("Re: pricing", "Sounds good, send me the pricing")).toBe("positive");
    expect(classifyInterest("Re: your email", "I'm interested, when can we talk?")).toBe("positive");
    expect(classifyInterest("Re: your email", "Can we book a call?")).toBe("positive");
  });

  test("a rejection is negative", () => {
    expect(classifyInterest("Re: your email", "Not interested, thanks")).toBe("negative");
    expect(classifyInterest("Re: your email", "Wrong person, please remove me from your list")).toBe("negative");
  });

  test("negative wins over positive", () => {
    expect(
      classifyInterest("Re: your email", "Not interested but please send pricing"),
    ).toBe("negative");
  });

  test("a pricing question is a buying signal, not a bare question", () => {
    expect(classifyInterest("Re: your email", "How much does this cost?")).toBe("positive");
  });

  test("a question without buying intent is engagement, not positive", () => {
    expect(classifyInterest("Re: your email", "Do you have an enterprise plan?")).toBe("question");
  });

  test("anything else is neutral", () => {
    expect(classifyInterest("Re: your email", "Received, will take a look.")).toBe("neutral");
  });
});

describe("hasOpportunitySignal", () => {
  test("a positive message about pricing is an opportunity", () => {
    expect(hasOpportunitySignal("positive", "Re: pricing", "send me pricing")).toBe(true);
  });

  test("a question about pricing is not — interest did not establish", () => {
    expect(hasOpportunitySignal("question", "Re: pricing", "how much is it?")).toBe(false);
  });

  test("a positive message with no buying signal is not an opportunity", () => {
    expect(hasOpportunitySignal("positive", "Re: hello", "sounds good")).toBe(false);
  });
});

describe("buildSnippet", () => {
  test("strips tags and collapses whitespace", () => {
    expect(buildSnippet("<p>Hello   <b>there</b></p>")).toBe("Hello there");
  });

  test("truncates", () => {
    expect(buildSnippet("a".repeat(500), 10)).toBe("aaaaaaaaaa");
  });

  test("handles null", () => {
    expect(buildSnippet(null)).toBe("");
  });
});
