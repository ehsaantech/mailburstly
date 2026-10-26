import { describe, expect, test } from "bun:test";

import { describe as describeRule, isBreached } from "./service";

describe("isBreached", () => {
  test("above fires when the metric rises past the threshold", () => {
    expect(isBreached(6, 5, "above")).toBe(true);
    expect(isBreached(4, 5, "above")).toBe(false);
  });

  test("below fires when the metric falls under the threshold", () => {
    expect(isBreached(1, 2, "below")).toBe(true);
    expect(isBreached(4, 2, "below")).toBe(false);
  });

  test("exactly on the threshold does not fire", () => {
    // A rule that fired on the boundary would flap: one tick at 5.0 and
    // the next at 4.99 would pause and unpause the campaign.
    expect(isBreached(5, 5, "above")).toBe(false);
    expect(isBreached(5, 5, "below")).toBe(false);
  });

  test("an unknown direction is treated as above", () => {
    expect(isBreached(6, 5, "sideways")).toBe(true);
  });
});

describe("describeRule", () => {
  test("says what happened for a rate", () => {
    const text = describeRule("bounce_rate", 6.4, 5, "above");
    expect(text).toContain("bounce rate");
    expect(text).toContain("6.4%");
    expect(text).toContain("above 5%");
  });

  test("says what happened for a fall", () => {
    const text = describeRule("reply_rate", 1.2, 2, "below");
    expect(text).toContain("reply rate");
    expect(text).toContain("below 2%");
  });

  test("mailbox health has no percent sign", () => {
    const text = describeRule("mailbox_health", 38, 40, "below");
    expect(text).toContain("mailbox health");
    expect(text).not.toContain("%");
  });

  test("an unknown metric still reads as a sentence", () => {
    const text = describeRule("something_new", 1, 2, "above");
    expect(text.length).toBeGreaterThan(10);
  });
});
