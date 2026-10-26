import { describe, expect, test } from "bun:test";

import { toCsv } from "./service";

describe("toCsv", () => {
  test("writes a header and one line per row", () => {
    const csv = toCsv(
      [
        { header: "type", value: (r) => r.type },
        { header: "count", value: (r) => r.count },
      ],
      [
        { type: "email_sent", count: 3 },
        { type: "reply_received", count: 1 },
      ],
    );

    expect(csv.split("\r\n")).toEqual([
      '"type","count"',
      '"email_sent","3"',
      '"reply_received","1"',
    ]);
  });

  test("quotes every value, so a comma cannot break the file", () => {
    const csv = toCsv(
      [{ header: "subject", value: (r) => r.subject }],
      [{ subject: "Quick question, about pricing" }],
    );
    expect(csv).toContain('"Quick question, about pricing"');
  });

  test("doubles an internal quote", () => {
    const csv = toCsv(
      [{ header: "subject", value: (r) => r.subject }],
      [{ subject: 'He said "yes"' }],
    );
    expect(csv).toContain('"He said ""yes"""');
  });

  test("a newline inside a value stays inside its quotes", () => {
    const csv = toCsv(
      [{ header: "body", value: (r) => r.body }],
      [{ body: "line one\nline two" }],
    );
    // The value is quoted, so a spreadsheet reads it as one cell.
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"line one\nline two"');
  });

  test("null and undefined become empty quoted cells", () => {
    const csv = toCsv(
      [
        { header: "a", value: (r) => r.a },
        { header: "b", value: (r) => r.b },
      ],
      [{ a: null, b: undefined }],
    );
    expect(csv.split("\r\n")[1]).toBe('"",""');
  });

  test("a date is written in ISO form", () => {
    const csv = toCsv(
      [{ header: "at", value: (r) => r.at }],
      [{ at: new Date("2026-01-05T10:00:00Z") }],
    );
    expect(csv).toContain('"2026-01-05T10:00:00.000Z"');
  });

  test("an empty result is just the header", () => {
    const csv = toCsv([{ header: "a", value: (r) => r.a }], []);
    expect(csv).toBe('"a"');
  });
});
