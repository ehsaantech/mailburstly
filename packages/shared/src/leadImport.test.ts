import { describe, expect, test } from "bun:test";

import {
  addGridRows,
  clearGridRow,
  createLeadGrid,
  DEFAULT_LEAD_COLUMNS,
  detectDelimiter,
  detectTargetKey,
  duplicateGridRow,
  gridCounts,
  gridKeyAction,
  gridRowIssues,
  gridToPayloads,
  importFileError,
  insertGridRow,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  parseDelimited,
  parseLeadsText,
  parseTable,
  pasteIntoGrid,
  removeGridRow,
  removeInvalidGridRows,
  slugifyKey,
  tableToLeads,
  updateGridCell,
  validateLeadRow,
  type LeadGrid,
} from "./leadImport.js";

/** Ids for a grid, so tests can address rows. */
function idMaker(prefix = "r"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function gridWith(rows: Record<string, string>[], columns = DEFAULT_LEAD_COLUMNS): LeadGrid {
  const makeId = idMaker();
  let grid = createLeadGrid(0, makeId, columns);
  for (const values of rows) {
    grid = addGridRows(grid, 1, makeId);
    const last = grid.rows[grid.rows.length - 1]!;
    grid = updateGridCell(grid, last.id, "email", values.email ?? "");
    if (values.firstName) grid = updateGridCell(grid, last.id, "firstName", values.firstName);
    if (values.company) grid = updateGridCell(grid, last.id, "company", values.company);
  }
  return grid;
}

/* -------------------------------------------------------------------------- */

describe("isValidEmail", () => {
  test("accepts ordinary addresses", () => {
    expect(isValidEmail("jane@acme.com")).toBe(true);
    expect(isValidEmail("jane.doe+tag@acme.co.uk")).toBe(true);
    expect(isValidEmail("jane_doe@acme.com")).toBe(true);
  });

  test("rejects addresses without a real domain", () => {
    expect(isValidEmail("jane@acme")).toBe(false);
    expect(isValidEmail("jane")).toBe(false);
    expect(isValidEmail("jane@")).toBe(false);
    expect(isValidEmail("@acme.com")).toBe(false);
  });

  test("rejects spaces, double dots and stray dots", () => {
    expect(isValidEmail("jane doe@acme.com")).toBe(false);
    expect(isValidEmail("jane@acme..com")).toBe(false);
    expect(isValidEmail(".jane@acme.com")).toBe(false);
    expect(isValidEmail("jane.@acme.com")).toBe(false);
  });

  test("rejects a numeric top level domain", () => {
    expect(isValidEmail("jane@acme.c")).toBe(false);
    expect(isValidEmail("jane@acme.123")).toBe(false);
  });

  test("rejects anything longer than 255 characters", () => {
    const long = `${"a".repeat(250)}@acme.com`;
    expect(long.length).toBeGreaterThan(255);
    expect(isValidEmail(long)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  test("trims and lower-cases", () => {
    expect(normalizeEmail("  Jane@Acme.COM ")).toBe("jane@acme.com");
  });

  test("strips zero-width characters and the byte-order mark", () => {
    expect(normalizeEmail("ja\u200Bne@acme.com")).toBe("jane@acme.com");
    expect(normalizeEmail("\uFEFFjane@acme.com")).toBe("jane@acme.com");
  });

  test("strips the excel formula marker", () => {
    expect(normalizeEmail("=jane@acme.com")).toBe("jane@acme.com");
  });
});

describe("isValidPhone", () => {
  test("an empty phone is fine, it is optional", () => {
    expect(isValidPhone("")).toBe(true);
    expect(isValidPhone("   ")).toBe(true);
  });

  test("accepts international numbers", () => {
    expect(isValidPhone("+44 20 7946 0958")).toBe(true);
    expect(isValidPhone("(555) 010-1234")).toBe(true);
  });

  test("rejects letters and numbers that are too short", () => {
    expect(isValidPhone("call me")).toBe(false);
    expect(isValidPhone("12345")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("validateLeadRow", () => {
  test("reports a missing email", () => {
    const issues = validateLeadRow({ email: "  " });
    expect(issues.map((issue) => issue.code)).toEqual(["email_required"]);
  });

  test("reports a malformed email", () => {
    const issues = validateLeadRow({ email: "jane@acme" });
    expect(issues.map((issue) => issue.code)).toEqual(["email_invalid"]);
  });

  test("reports an over-long email with a readable message", () => {
    const issues = validateLeadRow({ email: `${"a".repeat(300)}@acme.com` });
    expect(issues.map((issue) => issue.code)).toEqual(["email_too_long"]);
    expect(issues[0]!.message).toContain("255");
  });

  test("reports a duplicate inside the batch", () => {
    const issues = validateLeadRow(
      { email: "jane@acme.com" },
      { seenEmails: new Set(["jane@acme.com"]) },
    );
    expect(issues.map((issue) => issue.code)).toEqual(["duplicate_in_batch"]);
  });

  test("reports a lead that already exists in the workspace", () => {
    const issues = validateLeadRow(
      { email: "Jane@Acme.com" },
      { existingEmails: ["jane@acme.com"] },
    );
    expect(issues.map((issue) => issue.code)).toEqual(["duplicate_existing"]);
  });

  test("reports fields that are too long and a bad phone", () => {
    const issues = validateLeadRow({
      email: "jane@acme.com",
      firstName: "x".repeat(200),
      phone: "abc",
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      "field_too_long",
      "phone_invalid",
    ]);
  });
});

/* -------------------------------------------------------------------------- */

describe("grid editing", () => {
  test("adds, duplicates, inserts and removes rows", () => {
    const makeId = idMaker();
    let grid = createLeadGrid(2, makeId);
    expect(grid.rows).toHaveLength(2);

    grid = addGridRows(grid, 3, makeId);
    expect(grid.rows).toHaveLength(5);

    const first = grid.rows[0]!.id;
    grid = updateGridCell(grid, first, "email", "jane@acme.com");

    const duplicated = duplicateGridRow(grid, first, makeId);
    expect(duplicated.rows).toHaveLength(6);
    expect(duplicated.rows[1]!.values.email).toBe("jane@acme.com");
    expect(duplicated.rows[1]!.id).not.toBe(first);

    const inserted = insertGridRow(duplicated, first, "above", makeId);
    expect(inserted.rows).toHaveLength(7);
    expect(inserted.rows[0]!.values.email).toBeUndefined();

    const removed = removeGridRow(inserted, first);
    expect(removed.rows).toHaveLength(6);
    expect(removed.rows.some((row) => row.id === first)).toBe(false);
  });

  test("clears a row without touching the others", () => {
    const grid = gridWith([
      { email: "a@acme.com" },
      { email: "b@acme.com" },
    ]);
    const target = grid.rows[0]!.id;
    const cleared = clearGridRow(grid, target);
    expect(cleared.rows[0]!.values.email).toBeUndefined();
    expect(cleared.rows[1]!.values.email).toBe("b@acme.com");
  });

  test("removes only the rows with a blocking problem", () => {
    const grid = gridWith([
      { email: "good@acme.com" },
      { email: "broken" },
      { email: "other@acme.com" },
    ]);
    const pruned = removeInvalidGridRows(grid);
    expect(pruned.rows).toHaveLength(2);
    expect(pruned.rows.map((row) => row.values.email)).toEqual([
      "good@acme.com",
      "other@acme.com",
    ]);
  });
});

describe("grid counts", () => {
  test("separates ready, invalid and duplicate rows", () => {
    const grid = gridWith([
      { email: "a@acme.com" },
      { email: "b@acme.com" },
      { email: "not-an-email" },
      { email: "a@acme.com" },
      { email: "" },
    ]);
    const counts = gridCounts(grid);
    expect(counts.total).toBe(4);
    expect(counts.ready).toBe(2);
    expect(counts.invalid).toBe(1);
    expect(counts.duplicate).toBe(1);
    expect(counts.empty).toBe(1);
  });

  test("counts a lead that already exists in the workspace as a duplicate", () => {
    const grid = gridWith([{ email: "a@acme.com" }]);
    const counts = gridCounts(grid, { existingEmails: ["a@acme.com"] });
    expect(counts.duplicate).toBe(1);
    expect(counts.ready).toBe(0);
  });
});

describe("gridToPayloads", () => {
  test("sends only the rows that can be imported", () => {
    const grid = gridWith([
      { email: "A@Acme.com", firstName: "Jane" },
      { email: "broken" },
      { email: "a@acme.com" },
    ]);
    const payloads = gridToPayloads(grid);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.email).toBe("a@acme.com");
    expect(payloads[0]!.firstName).toBe("Jane");
  });

  test("sends custom columns as custom variables", () => {
    const makeId = idMaker();
    let grid = createLeadGrid(1, makeId);
    grid = updateGridCell(grid, grid.rows[0]!.id, "email", "jane@acme.com");
    grid = {
      ...grid,
      columns: [
        ...grid.columns,
        { key: "employees", label: "Employees", custom: true },
      ],
    };
    grid = updateGridCell(grid, grid.rows[0]!.id, "employees", "120");

    const payloads = gridToPayloads(grid);
    expect(payloads[0]!.customVariables).toEqual({
      employees: "120",
    });
  });

  test("sends LinkedIn and photo URLs as built-in fields", () => {
    const makeId = idMaker();
    let grid = createLeadGrid(1, makeId);
    grid = updateGridCell(grid, grid.rows[0]!.id, "email", "jane@acme.com");
    grid = updateGridCell(grid, grid.rows[0]!.id, "linkedinUrl", "https://li/jane");
    grid = updateGridCell(grid, grid.rows[0]!.id, "photoUrl", "https://cdn/jane.jpg");

    const payloads = gridToPayloads(grid);
    expect(payloads[0]!.linkedinUrl).toBe("https://li/jane");
    expect(payloads[0]!.photoUrl).toBe("https://cdn/jane.jpg");
    expect(payloads[0]!.customVariables).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe("detectDelimiter", () => {
  test("picks the delimiter that shows up most often", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
  });

  test("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('"Acme, Inc.";email\n"Acme, Inc.";a@acme.com')).toBe(";");
  });
});

describe("parseDelimited", () => {
  test("keeps quoted commas inside one cell", () => {
    expect(parseDelimited('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  test("unescapes doubled quotes", () => {
    expect(parseDelimited('"say ""hi""",b')).toEqual([['say "hi"', "b"]]);
  });

  test("handles CRLF line endings", () => {
    expect(parseDelimited("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("keeps a newline inside a quoted cell", () => {
    expect(parseDelimited('"one\ntwo",b')).toEqual([["one\ntwo", "b"]]);
  });

  test("strips the byte-order mark", () => {
    expect(parseDelimited("\uFEFFemail,name")).toEqual([["email", "name"]]);
  });

  test("drops the trailing empty line", () => {
    expect(parseDelimited("a,b\n")).toHaveLength(1);
  });
});

describe("detectTargetKey", () => {
  test("matches the aliases people actually use", () => {
    expect(detectTargetKey("Work email")).toBe("email");
    expect(detectTargetKey("E-Mail")).toBe("email");
    expect(detectTargetKey("Given name")).toBe("firstName");
    expect(detectTargetKey("Surname")).toBe("lastName");
    expect(detectTargetKey("Organisation")).toBe("company");
    expect(detectTargetKey("Job title")).toBe("title");
    expect(detectTargetKey("Mobile")).toBe("phone");
    expect(detectTargetKey("LinkedIn URL")).toBe("linkedinUrl");
    expect(detectTargetKey("LinkedIn Profile")).toBe("linkedinUrl");
    expect(detectTargetKey("Photo URL")).toBe("photoUrl");
    expect(detectTargetKey("Avatar")).toBe("photoUrl");
  });

  test("returns null for an unknown header", () => {
    expect(detectTargetKey("Favourite colour")).toBeNull();
  });
});

describe("parseTable", () => {
  test("detects a header row", () => {
    const table = parseTable("email,firstName\njane@acme.com,Jane");
    expect(table.headers).toEqual(["email", "firstName"]);
    expect(table.rows).toEqual([["jane@acme.com", "Jane"]]);
  });

  test("treats a table without a header as all data", () => {
    const table = parseTable("jane@acme.com,Jane");
    expect(table.headers).toBeNull();
    expect(table.rows).toHaveLength(1);
  });

  test("ignores blank lines", () => {
    const table = parseTable("email\n\njane@acme.com\n\n");
    expect(table.rows).toHaveLength(1);
  });
});

describe("tableToLeads", () => {
  test("maps columns by header name", () => {
    const table = parseTable(
      "Work email,Given name,Surname,Organisation,Role\njane@acme.com,Jane,Doe,Acme,VP Sales",
    );
    const { leads, unmapped } = tableToLeads(table);
    expect(unmapped).toEqual([]);
    expect(leads).toEqual([
      {
        email: "jane@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        company: "Acme",
        title: "VP Sales",
      },
    ]);
  });

  test("reports headers it did not understand", () => {
    const table = parseTable("email,Favourite colour\njane@acme.com,blue");
    const { leads, unmapped } = tableToLeads(table);
    expect(unmapped).toEqual(["Favourite colour"]);
    expect(leads[0]!.email).toBe("jane@acme.com");
  });

  test("maps LinkedIn and photo columns to their built-in fields", () => {
    const table = parseTable(
      "email,LinkedIn URL,Photo URL\njane@acme.com,https://li/jane,https://cdn/jane.jpg",
    );
    const { leads, unmapped } = tableToLeads(table);
    expect(unmapped).toEqual([]);
    expect(leads[0]!.linkedinUrl).toBe("https://li/jane");
    expect(leads[0]!.photoUrl).toBe("https://cdn/jane.jpg");
  });

  test("falls back to positional columns when there is no header", () => {
    const table = parseTable(
      "jane@acme.com,Jane,Doe,Acme,VP Sales,+441234,https://li/jane,https://cdn/jane.jpg",
    );
    const { leads } = tableToLeads(table);
    expect(leads[0]).toEqual({
      email: "jane@acme.com",
      firstName: "Jane",
      lastName: "Doe",
      company: "Acme",
      title: "VP Sales",
      phone: "+441234",
      linkedinUrl: "https://li/jane",
      photoUrl: "https://cdn/jane.jpg",
    });
  });

  test("skips rows without an email and counts them", () => {
    const table = parseTable("email,company\njane@acme.com,Acme\n,Empty Co");
    const { leads, skipped } = tableToLeads(table);
    expect(leads).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  test("parseLeadsText is the one-shot version", () => {
    const { leads } = parseLeadsText("email,firstName\njane@acme.com,Jane");
    expect(leads).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("pasteIntoGrid", () => {
  test("maps a pasted header row onto the right columns", () => {
    const makeId = idMaker();
    let grid = createLeadGrid(2, makeId);
    const anchor = grid.rows[0]!.id;

    const result = pasteIntoGrid(
      grid,
      "Work email,Given name,Company\njane@acme.com,Jane,Acme\njohn@beta.io,John,Beta",
      { rowId: anchor, columnIndex: 0 },
      makeId,
    );

    expect(result.mappedFromHeader).toBe(true);
    expect(result.pastedRows).toBe(2);
    expect(result.grid.rows[0]!.values).toMatchObject({
      email: "jane@acme.com",
      firstName: "Jane",
      company: "Acme",
    });
    expect(result.grid.rows[1]!.values.email).toBe("john@beta.io");
  });

  test("turns an unknown header into a custom column", () => {
    const makeId = idMaker();
    const grid = createLeadGrid(1, makeId);
    const result = pasteIntoGrid(
      grid,
      "email,Favourite colour\njane@acme.com,blue",
      { rowId: grid.rows[0]!.id, columnIndex: 0 },
      makeId,
    );
    expect(result.addedColumns).toEqual(["favourite_colour"]);
    expect(result.grid.rows[0]!.values.favourite_colour).toBe("blue");
  });

  test("pastes positionally when the clipboard has no header", () => {
    const makeId = idMaker();
    const grid = createLeadGrid(3, makeId);
    const result = pasteIntoGrid(
      grid,
      "jane@acme.com\tJane\tDoe\tAcme",
      { rowId: grid.rows[1]!.id, columnIndex: 0 },
      makeId,
    );
    expect(result.mappedFromHeader).toBe(false);
    expect(result.grid.rows[1]!.values).toMatchObject({
      email: "jane@acme.com",
      firstName: "Jane",
      company: "Acme",
    });
    expect(result.grid.rows[2]!.values.email).toBeUndefined();
  });

  test("grows the grid when the paste is longer than the grid", () => {
    const makeId = idMaker();
    const grid = createLeadGrid(1, makeId);
    const result = pasteIntoGrid(
      grid,
      "a@acme.com\nb@acme.com\nc@acme.com",
      { rowId: grid.rows[0]!.id, columnIndex: 0 },
      makeId,
    );
    expect(result.grid.rows).toHaveLength(3);
    expect(result.grid.rows[2]!.values.email).toBe("c@acme.com");
  });
});

/* -------------------------------------------------------------------------- */

describe("gridKeyAction", () => {
  const context = {
    rowId: "r1",
    columnIndex: 0,
    rowCount: 3,
    columnCount: 6,
    rowIds: ["r1", "r2", "r3"],
    rowIndex: 0,
  };

  test("tab moves to the next cell", () => {
    expect(
      gridKeyAction({ key: "Tab", metaKey: false, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "move", rowId: "r1", columnIndex: 1 });
  });

  test("shift+tab moves back a cell", () => {
    expect(
      gridKeyAction({ key: "Tab", metaKey: false, ctrlKey: false, shiftKey: true }, {
        ...context,
        columnIndex: 2,
      }),
    ).toEqual({ type: "move", rowId: "r1", columnIndex: 1 });
  });

  test("tab at the end of a row moves to the next row", () => {
    expect(
      gridKeyAction({ key: "Tab", metaKey: false, ctrlKey: false, shiftKey: false }, {
        ...context,
        columnIndex: 5,
      }),
    ).toEqual({ type: "move", rowId: "r2", columnIndex: 0 });
  });

  test("shift+tab on the first cell moves to the end of the row above", () => {
    expect(
      gridKeyAction({ key: "Tab", metaKey: false, ctrlKey: false, shiftKey: true }, {
        ...context,
        rowIndex: 1,
      }),
    ).toEqual({ type: "move", rowId: "r1", columnIndex: 5 });
  });

  test("enter moves down", () => {
    expect(
      gridKeyAction({ key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "move", rowId: "r2", columnIndex: 0 });
  });

  test("the arrow keys move around", () => {
    expect(
      gridKeyAction({ key: "ArrowDown", metaKey: false, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "move", rowId: "r2", columnIndex: 0 });
    expect(
      gridKeyAction({ key: "ArrowUp", metaKey: false, ctrlKey: false, shiftKey: false }, {
        ...context,
        rowIndex: 2,
      }),
    ).toEqual({ type: "move", rowId: "r2", columnIndex: 0 });
    expect(
      gridKeyAction({ key: "ArrowRight", metaKey: false, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "move", rowId: "r1", columnIndex: 1 });
  });

  test("cmd+enter imports", () => {
    expect(
      gridKeyAction({ key: "Enter", metaKey: true, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "import" });
    expect(
      gridKeyAction({ key: "Enter", metaKey: false, ctrlKey: true, shiftKey: false }, context),
    ).toEqual({ type: "import" });
  });

  test("cmd+backspace clears the row", () => {
    expect(
      gridKeyAction({ key: "Backspace", metaKey: true, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "clear-row", rowId: "r1" });
  });

  test("cmd+d duplicates the row", () => {
    expect(
      gridKeyAction({ key: "d", metaKey: true, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "duplicate-row", rowId: "r1" });
  });

  test("does nothing at the edge of the grid", () => {
    expect(
      gridKeyAction({ key: "ArrowUp", metaKey: false, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "none" });
    expect(
      gridKeyAction({ key: "ArrowLeft", metaKey: false, ctrlKey: false, shiftKey: false }, context),
    ).toEqual({ type: "none" });
  });
});

describe("importFileError", () => {
  test("accepts a csv file", () => {
    expect(importFileError("leads.csv", 1024)).toBeNull();
    expect(importFileError("leads.tsv", 1024)).toBeNull();
    expect(importFileError("leads.txt", 1024)).toBeNull();
  });

  test("accepts a text file with no extension when the browser says it is text", () => {
    expect(importFileError("leads", 1024, "text/csv")).toBeNull();
  });

  test("refuses a file that is not a csv", () => {
    const message = importFileError("deck.pdf", 1024, "application/pdf");
    expect(message).toContain("not a CSV");
  });

  test("refuses an empty file", () => {
    expect(importFileError("leads.csv", 0)).toContain("empty");
  });

  test("refuses a file that is too large", () => {
    expect(importFileError("leads.csv", 6 * 1024 * 1024)).toContain("larger than");
  });
});

describe("slugifyKey", () => {
  test("turns a label into a custom variable key", () => {
    expect(slugifyKey("LinkedIn URL")).toBe("linkedin_url");
    expect(slugifyKey("  Job  Title  ")).toBe("job_title");
    expect(slugifyKey("!!!")).toBe("custom_field");
  });
});

describe("gridRowIssues", () => {
  test("flags the second occurrence of an email, not the first", () => {
    const grid = gridWith([
      { email: "same@acme.com" },
      { email: "same@acme.com" },
    ]);
    const issues = gridRowIssues(grid);
    expect(issues.get(grid.rows[0]!.id)).toBeUndefined();
    expect(issues.get(grid.rows[1]!.id)?.[0]?.code).toBe("duplicate_in_batch");
  });
});
