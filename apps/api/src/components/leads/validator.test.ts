import { describe, expect, test } from "bun:test";

import { importLeadsSchema } from "./validator";

describe("importLeadsSchema", () => {
  test("accepts a batch that contains a broken email", () => {
    const result = importLeadsSchema.safeParse({
      leads: [
        { email: "jane@acme.com" },
        { email: "not-an-email" },
        { email: "" },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("accepts a lead with no optional fields", () => {
    const result = importLeadsSchema.safeParse({ leads: [{ email: "jane@acme.com" }] });
    expect(result.success).toBe(true);
  });

  test("accepts custom variables of any primitive type", () => {
    const result = importLeadsSchema.safeParse({
      leads: [{ email: "jane@acme.com", customVariables: { seats: 12, vip: true } }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects a body that is not a batch", () => {
    expect(importLeadsSchema.safeParse({ leads: "jane@acme.com" }).success).toBe(false);
  });

  test("rejects an empty batch", () => {
    expect(importLeadsSchema.safeParse({ leads: [] }).success).toBe(false);
  });

  test("rejects more than ten thousand rows", () => {
    const leads = Array.from({ length: 10001 }, (_, index) => ({
      email: `lead${index}@acme.com`,
    }));
    expect(importLeadsSchema.safeParse({ leads }).success).toBe(false);
  });
});
