import { describe, expect, test } from "bun:test";

import {
  evaluateStopConditions,
  isLeadAvailable,
  isWithinSendWindow,
  nextWindowOpen,
  parseSchedule,
  parseTime,
  remainingNewLeadAllowance,
  resolveRules,
  zonedParts,
  type CampaignRules,
  type StopContext,
} from "./schedule.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const baseRules: CampaignRules = {
  schedule: null,
  stopOnReply: true,
  stopOnAutoReply: false,
  stopForCompany: true,
  dailyMaxLeads: null,
};

const baseContext: StopContext = {
  hasReply: false,
  hasAutoReply: false,
  unsubscribed: false,
  bounced: false,
  companyAlreadyContacted: false,
  oooUntil: null,
};

/* -------------------------------------------------------------------------- */
/* Timezone helpers                                                            */
/* -------------------------------------------------------------------------- */

describe("zonedParts", () => {
  test("reads the wall clock in the target timezone", () => {
    const d = new Date("2026-01-05T15:30:00Z");
    const parts = zonedParts(d, "America/New_York");
    expect(parts.dayOfWeek).toBe(1); // Monday
    expect(parts.minutes).toBe(10 * 60 + 30);
    expect(parts.time).toBe("10:30");
  });

  test("handles midnight without rolling to hour 24", () => {
    const d = new Date("2026-01-05T00:00:00Z");
    const parts = zonedParts(d, "UTC");
    expect(parts.minutes).toBe(0);
    expect(parts.time).toBe("00:00");
    expect(parts.dayOfWeek).toBe(1); // Monday
  });

  test("reads a day across a DST boundary", () => {
    // 2026-03-08 is the US spring-forward date.
    const before = zonedParts(new Date("2026-03-08T06:30:00Z"), "America/New_York");
    expect(before.minutes).toBe(1 * 60 + 30);
  });
});

describe("parseTime", () => {
  test("parses HH:MM", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("23:59")).toBe(1439);
  });

  test("rejects malformed values", () => {
    expect(parseTime("9am")).toBeNull();
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Send windows                                                                */
/* -------------------------------------------------------------------------- */

describe("isWithinSendWindow", () => {
  test("an empty schedule is always open", () => {
    expect(isWithinSendWindow(null, new Date("2026-01-05T03:00:00Z"))).toBe(true);
    expect(isWithinSendWindow({}, new Date("2026-01-05T03:00:00Z"))).toBe(true);
  });

  test("mode always is always open", () => {
    expect(
      isWithinSendWindow({ mode: "always" }, new Date("2026-01-05T03:00:00Z")),
    ).toBe(true);
  });

  test("office hours exclude the weekend", () => {
    const schedule = { mode: "office_hours" as const };
    // Saturday 2026-01-10 at 10:00 UTC.
    expect(isWithinSendWindow(schedule, new Date("2026-01-10T10:00:00Z"), "UTC")).toBe(false);
    // Monday 2026-01-12 at 10:00 UTC.
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T10:00:00Z"), "UTC")).toBe(true);
  });

  test("office hours exclude the evening", () => {
    const schedule = { mode: "office_hours" as const };
    // Monday 2026-01-12 at 22:00 UTC.
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T22:00:00Z"), "UTC")).toBe(false);
  });

  test("a custom window only opens on its days", () => {
    const schedule = {
      mode: "custom" as const,
      rules: [
        { daysOfWeek: [3], startTime: "09:00", endTime: "12:00", timezone: "UTC" },
      ],
    };
    // Wednesday 2026-01-14 at 10:00 UTC — inside.
    expect(isWithinSendWindow(schedule, new Date("2026-01-14T10:00:00Z"))).toBe(true);
    // Thursday 2026-01-15 at 10:00 UTC — outside.
    expect(isWithinSendWindow(schedule, new Date("2026-01-15T10:00:00Z"))).toBe(false);
    // Wednesday at 13:00 — outside the hours.
    expect(isWithinSendWindow(schedule, new Date("2026-01-14T13:00:00Z"))).toBe(false);
  });

  test("the window is evaluated in the rule's timezone, not the server's", () => {
    const schedule = {
      mode: "custom" as const,
      rules: [
        {
          daysOfWeek: [1],
          startTime: "09:00",
          endTime: "17:00",
          timezone: "America/New_York",
        },
      ],
    };
    // 14:00 UTC on a Monday is 09:00 in New York — inside.
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T14:00:00Z"))).toBe(true);
    // 18:00 UTC is 13:00 in New York — also inside.
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T18:00:00Z"))).toBe(true);
    // 23:00 UTC is 18:00 in New York — outside.
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T23:00:00Z"))).toBe(false);
  });

  test("an overnight window covers the small hours", () => {
    const schedule = {
      mode: "custom" as const,
      rules: [
        { daysOfWeek: [1], startTime: "22:00", endTime: "06:00", timezone: "UTC" },
      ],
    };
    // Monday 23:00 — inside the evening half.
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T23:00:00Z"))).toBe(true);
    // Tuesday 02:00 — inside the morning half of Monday's window.
    expect(isWithinSendWindow(schedule, new Date("2026-01-13T02:00:00Z"))).toBe(true);
    // Tuesday 07:00 — outside.
    expect(isWithinSendWindow(schedule, new Date("2026-01-13T07:00:00Z"))).toBe(false);
    // Monday 12:00 — outside.
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T12:00:00Z"))).toBe(false);
  });

  test("the end of a window is exclusive", () => {
    const schedule = {
      mode: "custom" as const,
      rules: [
        { daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", timezone: "UTC" },
      ],
    };
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T16:59:00Z"))).toBe(true);
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T17:00:00Z"))).toBe(false);
  });

  test("a malformed rule is ignored rather than blocking every send", () => {
    const schedule = {
      mode: "custom" as const,
      rules: [
        { daysOfWeek: [1], startTime: "nope", endTime: "17:00", timezone: "UTC" },
        { daysOfWeek: [1], startTime: "09:00", endTime: "17:00", timezone: "UTC" },
      ],
    };
    expect(isWithinSendWindow(schedule, new Date("2026-01-12T10:00:00Z"))).toBe(true);
  });
});

describe("parseSchedule", () => {
  test("a non-object is no schedule", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule("nonsense")).toBeNull();
    expect(parseSchedule(42)).toBeNull();
  });

  test("an unknown mode is no schedule", () => {
    expect(parseSchedule({ mode: "whenever" })).toBeNull();
  });

  test("always and office_hours pass through", () => {
    expect(parseSchedule({ mode: "always" })).toEqual({ mode: "always" });
    expect(parseSchedule({ mode: "office_hours" })).toEqual({ mode: "office_hours" });
  });

  test("custom keeps only well-formed rules", () => {
    const parsed = parseSchedule({
      mode: "custom",
      rules: [
        { daysOfWeek: [1, 2], startTime: "09:00", endTime: "17:00", timezone: "UTC" },
        { daysOfWeek: [], startTime: "09:00", endTime: "17:00" },
        { daysOfWeek: [3], startTime: "bad", endTime: "17:00" },
        { daysOfWeek: [9], startTime: "09:00", endTime: "17:00" },
        "not a rule",
      ],
    });
    expect(parsed!.rules).toHaveLength(1);
    expect(parsed!.rules![0]!.daysOfWeek).toEqual([1, 2]);
  });

  test("a custom schedule with no valid rules never opens", () => {
    // A deliberate custom schedule whose rules are all broken is a
    // schedule that never opens. Treating it as "always" would send around
    // the clock because of a typo.
    const parsed = parseSchedule({ mode: "custom", rules: "garbage" });
    expect(parsed).toEqual({ mode: "custom", rules: [] });
    expect(
      isWithinSendWindow(parsed, new Date("2026-01-05T03:00:00Z")),
    ).toBe(false);
  });

  test("a missing schedule means always send, not never send", () => {
    // The other half of the rule: a row with no schedule at all must not
    // silently stop a campaign.
    expect(parseSchedule(null)).toBeNull();
    expect(isWithinSendWindow(null, new Date("2026-01-05T03:00:00Z"))).toBe(true);
    expect(
      isWithinSendWindow(parseSchedule("nonsense"), new Date("2026-01-05T03:00:00Z")),
    ).toBe(true);
  });
});

describe("resolveRules", () => {
  test("always resolves to no rules", () => {
    expect(resolveRules({ mode: "always" }, "UTC")).toEqual([]);
  });

  test("office hours inherit the fallback timezone", () => {
    const rules = resolveRules({ mode: "office_hours" }, "Europe/London");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.timezone).toBe("Europe/London");
    expect(rules[0]!.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  test("custom rules with no days are dropped", () => {
    const rules = resolveRules(
      { mode: "custom", rules: [{ daysOfWeek: [], startTime: "09:00", endTime: "10:00" }] },
      "UTC",
    );
    expect(rules).toEqual([]);
  });
});

describe("nextWindowOpen", () => {
  test("returns null for an always-open schedule", () => {
    expect(nextWindowOpen(null, new Date("2026-01-05T03:00:00Z"))).toBeNull();
  });

  test("finds the next opening", () => {
    const schedule = {
      mode: "custom" as const,
      rules: [
        { daysOfWeek: [1], startTime: "09:00", endTime: "17:00", timezone: "UTC" },
      ],
    };
    // Sunday 2026-01-11 12:00 — the next Monday 09:00 is the answer.
    const next = nextWindowOpen(schedule, new Date("2026-01-11T12:00:00Z"));
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2026-01-12T09:00:00.000Z");
  });
});

/* -------------------------------------------------------------------------- */
/* Stop conditions                                                             */
/* -------------------------------------------------------------------------- */

describe("evaluateStopConditions", () => {
  test("a plain lead is not stopped", () => {
    expect(evaluateStopConditions(baseRules, baseContext)).toEqual({
      stop: false,
      reason: null,
    });
  });

  test("stop_on_reply stops a lead that replied", () => {
    const decision = evaluateStopConditions(baseRules, {
      ...baseContext,
      hasReply: true,
    });
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe("replied");
  });

  test("stop_on_reply off lets a replier keep receiving emails", () => {
    const decision = evaluateStopConditions(
      { ...baseRules, stopOnReply: false },
      { ...baseContext, hasReply: true },
    );
    expect(decision.stop).toBe(false);
  });

  test("stop_on_auto_reply only applies when enabled", () => {
    const context = { ...baseContext, hasAutoReply: true };
    expect(evaluateStopConditions(baseRules, context).stop).toBe(false);
    expect(
      evaluateStopConditions({ ...baseRules, stopOnAutoReply: true }, context).reason,
    ).toBe("auto_replied");
  });

  test("stop_for_company stops a second lead from the same company", () => {
    const decision = evaluateStopConditions(baseRules, {
      ...baseContext,
      companyAlreadyContacted: true,
    });
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe("same_company");
  });

  test("an unsubscribe outranks every other rule", () => {
    const decision = evaluateStopConditions(
      { ...baseRules, stopOnReply: false, stopForCompany: false },
      { ...baseContext, unsubscribed: true, hasReply: true },
    );
    expect(decision.reason).toBe("unsubscribed");
  });

  test("a bounce outranks the campaign rules", () => {
    const decision = evaluateStopConditions(baseRules, {
      ...baseContext,
      bounced: true,
      hasReply: true,
    });
    expect(decision.reason).toBe("bounced");
  });
});

describe("isLeadAvailable", () => {
  test("a lead with no out-of-office is available", () => {
    expect(isLeadAvailable(baseContext, new Date())).toEqual({
      available: true,
      reason: null,
    });
  });

  test("a lead away until tomorrow is not available", () => {
    const now = new Date("2026-01-05T10:00:00Z");
    const context = { ...baseContext, oooUntil: new Date("2026-01-06T09:00:00Z") };
    expect(isLeadAvailable(context, now)).toEqual({
      available: false,
      reason: "out_of_office",
    });
  });

  test("a lead whose out-of-office has passed is available again", () => {
    const now = new Date("2026-01-06T10:00:00Z");
    const context = { ...baseContext, oooUntil: new Date("2026-01-06T09:00:00Z") };
    expect(isLeadAvailable(context, now).available).toBe(true);
  });
});

describe("remainingNewLeadAllowance", () => {
  test("no cap means no limit", () => {
    expect(remainingNewLeadAllowance(null, 500)).toBe(Number.POSITIVE_INFINITY);
  });

  test("a cap is the difference", () => {
    expect(remainingNewLeadAllowance(100, 40)).toBe(60);
  });

  test("a cap that is already used up is zero", () => {
    expect(remainingNewLeadAllowance(100, 120)).toBe(0);
  });
});
