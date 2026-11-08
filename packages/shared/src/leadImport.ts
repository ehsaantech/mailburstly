/**
 * Lead import: parsing, validation and grid editing.
 *
 * Everything here is a pure function of its arguments, and both sides of the
 * wire use it: the browser runs it while the operator types or drops a file,
 * the api runs it again when the batch lands. One rule, one place — an email
 * the ui calls valid must be valid for the api too, otherwise a batch that
 * looked fine fails at the last step with a wall of field errors.
 *
 * Import policy (enforced in `apps/api/src/components/leads/service.ts`):
 *
 *   - A row with a missing, malformed or over-long email is *rejected*. It is
 *     reported with its row number and reason; it never blocks the rest of
 *     the batch.
 *   - A row whose email already exists (in the workspace or earlier in the
 *     same batch) is *skipped*. It is not an error, it is a no-op.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** The built-in lead fields, in the order they appear in the grid. */
export const LEAD_COLUMN_KEYS = [
  "email",
  "firstName",
  "lastName",
  "company",
  "title",
  "phone",
  "linkedinUrl",
  "photoUrl",
] as const;
export type LeadColumnKey = (typeof LEAD_COLUMN_KEYS)[number];

export const LEAD_COLUMN_LABELS: Record<LeadColumnKey, string> = {
  email: "Email",
  firstName: "First name",
  lastName: "Last name",
  company: "Company",
  title: "Title",
  phone: "Phone",
  linkedinUrl: "LinkedIn URL",
  photoUrl: "Photo URL",
};

/** Field limits. The api validator enforces the same numbers. */
export const LEAD_FIELD_LIMITS = {
  email: 255,
  firstName: 120,
  lastName: 120,
  company: 200,
  title: 200,
  phone: 40,
  linkedinUrl: 2048,
  photoUrl: 2048,
} as const;

/** What the import endpoint accepts for one lead. */
export interface LeadPayload {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  phone?: string;
  linkedinUrl?: string;
  photoUrl?: string;
  customVariables?: Record<string, string>;
}

/** One row the user is editing in the manual table. */
export interface LeadGridColumn {
  key: string;
  label: string;
  /** True for columns the operator added; they ride along as custom variables. */
  custom: boolean;
}

export interface LeadGridRow {
  id: string;
  values: Record<string, string>;
}

export interface LeadGrid {
  columns: LeadGridColumn[];
  rows: LeadGridRow[];
}

/** Why a row cannot be imported (or that it will be skipped). */
export type LeadIssueCode =
  | "email_required"
  | "email_invalid"
  | "email_too_long"
  | "field_too_long"
  | "phone_invalid"
  | "duplicate_in_batch"
  | "duplicate_existing";

export interface LeadIssue {
  code: LeadIssueCode;
  /** The grid column the issue belongs to. */
  field: string;
  message: string;
}

/** A row the api refused, with the row number the operator will recognise. */
export interface LeadRowError {
  /** 1-based row number in the submitted batch. */
  row: number;
  email: string;
  code: LeadIssueCode;
  message: string;
}

/** Counts for the grid footer. */
export interface GridCounts {
  /** Rows with any content. */
  total: number;
  /** Rows that will be sent to the api. */
  ready: number;
  /** Rows with a blocking problem. */
  invalid: number;
  /** Rows that already exist (in the workspace or earlier in the batch). */
  duplicate: number;
  /** Completely empty rows — ignored. */
  empty: number;
}

export interface ValidateRowOptions {
  /** Emails that already exist in the workspace. */
  existingEmails?: Iterable<string>;
  /** Emails already seen earlier in the batch. */
  seenEmails?: Set<string>;
}

/* -------------------------------------------------------------------------- */
/* Email handling                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Characters that survive a copy/paste but break an address: zero-width
 * spaces, a byte-order mark, and Excel's "this cell is a formula" marker.
 */
const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;

/** Strips characters that must never reach the api. */
export function stripInvisible(value: string): string {
  const stripped = value.replace(INVISIBLE, "");
  return stripped.startsWith("=") ? stripped.slice(1) : stripped;
}

/** Trimmed, lower-cased, invisible characters removed. */
export function normalizeEmail(value: string): string {
  return stripInvisible(value).trim().toLowerCase();
}

/**
 * Email shape check.
 *
 * Deliberately mirrors zod's `.email()` (the api's own rule) instead of
 * inventing a looser one: a ui that accepts `foo@bar` and an api that
 * rejects it is a bug report waiting to happen.
 */
export function isValidEmail(value: string): boolean {
  const email = stripInvisible(value).trim();
  if (!email || email.length > LEAD_FIELD_LIMITS.email) return false;
  if (email.includes("..")) return false;

  const at = email.indexOf("@");
  if (at <= 0) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[A-Z0-9_'+\-.]+$/i.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".")) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1] ?? "";
  if (!/^[A-Z]{2,}$/i.test(tld)) return false;
  return labels
    .slice(0, -1)
    .every((label) => /^[A-Z0-9](?:[A-Z0-9-]*)$/i.test(label));
}

/** A phone number is optional, but if it is there it has to look like one. */
export function isValidPhone(value: string): boolean {
  const phone = stripInvisible(value).trim();
  if (!phone) return true;
  if (!/^[0-9+()\-.\s]+$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/* -------------------------------------------------------------------------- */
/* Row validation                                                              */
/* -------------------------------------------------------------------------- */

function fieldIssue(
  code: LeadIssueCode,
  field: string,
  message: string,
): LeadIssue {
  return { code, field, message };
}

/**
 * Checks one row of the grid.
 *
 * `duplicate_in_batch` and `duplicate_existing` are not blocking: those rows
 * are skipped, not rejected. Everything else blocks the row.
 */
export function validateLeadRow(
  values: Record<string, string>,
  options: ValidateRowOptions = {},
): LeadIssue[] {
  const issues: LeadIssue[] = [];
  const rawEmail = values.email ?? "";
  const email = normalizeEmail(rawEmail);

  if (!email) {
    issues.push(fieldIssue("email_required", "email", "Email is required"));
  } else {
    if (rawEmail.trim().length > LEAD_FIELD_LIMITS.email) {
      issues.push(
        fieldIssue(
          "email_too_long",
          "email",
          `Email must be ${LEAD_FIELD_LIMITS.email} characters or fewer`,
        ),
      );
    } else if (!isValidEmail(email)) {
      issues.push(
        fieldIssue("email_invalid", "email", `"${rawEmail.trim()}" is not a valid email`),
      );
    } else if (options.seenEmails?.has(email)) {
      issues.push(
        fieldIssue("duplicate_in_batch", "email", "Duplicate of an earlier row"),
      );
    } else if (options.existingEmails && hasEmail(options.existingEmails, email)) {
      issues.push(
        fieldIssue("duplicate_existing", "email", "This lead already exists"),
      );
    }
  }

  for (const key of ["firstName", "lastName", "company", "title", "linkedinUrl", "photoUrl"] as const) {
    const value = values[key] ?? "";
    if (value.trim().length > LEAD_FIELD_LIMITS[key]) {
      issues.push(
        fieldIssue(
          "field_too_long",
          key,
          `${LEAD_COLUMN_LABELS[key]} must be ${LEAD_FIELD_LIMITS[key]} characters or fewer`,
        ),
      );
    }
  }

  const phone = values.phone ?? "";
  if (!isValidPhone(phone)) {
    issues.push(fieldIssue("phone_invalid", "phone", "Phone number looks invalid"));
  }

  return issues;
}

/** True when an issue stops the row from being imported. */
export function isBlockingIssue(issue: LeadIssue): boolean {
  return (
    issue.code !== "duplicate_in_batch" && issue.code !== "duplicate_existing"
  );
}

function hasEmail(emails: Iterable<string>, email: string): boolean {
  for (const candidate of emails) {
    if (normalizeEmail(candidate) === email) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Grid model                                                                  */
/* -------------------------------------------------------------------------- */

export const DEFAULT_LEAD_COLUMNS: LeadGridColumn[] = [
  { key: "email", label: "Email", custom: false },
  { key: "firstName", label: "First name", custom: false },
  { key: "lastName", label: "Last name", custom: false },
  { key: "company", label: "Company", custom: false },
  { key: "title", label: "Title", custom: false },
  { key: "phone", label: "Phone", custom: false },
  { key: "linkedinUrl", label: "LinkedIn URL", custom: false },
  { key: "photoUrl", label: "Photo URL", custom: false },
];

/** A blank row. */
export function createGridRow(id: string): LeadGridRow {
  return { id, values: {} };
}

/** A grid with `columns` and `rowCount` blank rows. */
export function createLeadGrid(
  rowCount: number,
  makeId: () => string,
  columns: LeadGridColumn[] = DEFAULT_LEAD_COLUMNS,
): LeadGrid {
  const rows: LeadGridRow[] = [];
  for (let i = 0; i < rowCount; i++) rows.push(createGridRow(makeId()));
  return { columns, rows };
}

/** True when a row has no content at all. */
export function isGridRowEmpty(row: LeadGridRow): boolean {
  return Object.values(row.values).every((value) => value.trim() === "");
}

export function addGridRows(
  grid: LeadGrid,
  count: number,
  makeId: () => string,
): LeadGrid {
  if (count <= 0) return grid;
  const rows = [...grid.rows];
  for (let i = 0; i < count; i++) rows.push(createGridRow(makeId()));
  return { ...grid, rows };
}

export function removeGridRow(grid: LeadGrid, rowId: string): LeadGrid {
  return { ...grid, rows: grid.rows.filter((row) => row.id !== rowId) };
}

export function duplicateGridRow(
  grid: LeadGrid,
  rowId: string,
  makeId: () => string,
): LeadGrid {
  const index = grid.rows.findIndex((row) => row.id === rowId);
  if (index < 0) return grid;
  const source = grid.rows[index]!;
  const copy: LeadGridRow = {
    id: makeId(),
    values: { ...source.values },
  };
  const rows = [...grid.rows];
  rows.splice(index + 1, 0, copy);
  return { ...grid, rows };
}

export function insertGridRow(
  grid: LeadGrid,
  rowId: string,
  where: "above" | "below",
  makeId: () => string,
): LeadGrid {
  const index = grid.rows.findIndex((row) => row.id === rowId);
  if (index < 0) return grid;
  const rows = [...grid.rows];
  rows.splice(where === "above" ? index : index + 1, 0, createGridRow(makeId()));
  return { ...grid, rows };
}

export function updateGridCell(
  grid: LeadGrid,
  rowId: string,
  key: string,
  value: string,
): LeadGrid {
  return {
    ...grid,
    rows: grid.rows.map((row) =>
      row.id === rowId
        ? { ...row, values: { ...row.values, [key]: value } }
        : row,
    ),
  };
}

export function clearGridRow(grid: LeadGrid, rowId: string): LeadGrid {
  return {
    ...grid,
    rows: grid.rows.map((row) =>
      row.id === rowId ? { ...row, values: {} } : row,
    ),
  };
}

/** "Fix all": trim and lower-case every email in the grid. */
export function normalizeGridEmails(grid: LeadGrid): LeadGrid {
  return {
    ...grid,
    rows: grid.rows.map((row) => {
      const email = row.values.email;
      if (email === undefined) return row;
      return {
        ...row,
        values: { ...row.values, email: normalizeEmail(email) },
      };
    }),
  };
}

/** Removes every column except email (and the custom ones the operator added). */
export function removeGridColumn(grid: LeadGrid, key: string): LeadGrid {
  if (key === "email") return grid;
  return {
    columns: grid.columns.filter((column) => column.key !== key),
    rows: grid.rows.map((row) => {
      const values = { ...row.values };
      delete values[key];
      return { ...row, values };
    }),
  };
}

export function addGridColumn(
  grid: LeadGrid,
  column: LeadGridColumn,
): LeadGrid {
  if (grid.columns.some((existing) => existing.key === column.key)) return grid;
  return { ...grid, columns: [...grid.columns, column] };
}

/* -------------------------------------------------------------------------- */
/* Grid validation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Issues per row id. Rows are checked in order, so the second occurrence of
 * an email is flagged as a duplicate of the first.
 */
export function gridRowIssues(
  grid: LeadGrid,
  options: ValidateRowOptions = {},
): Map<string, LeadIssue[]> {
  const seen = new Set<string>(options.seenEmails ?? []);
  const issues = new Map<string, LeadIssue[]>();

  for (const row of grid.rows) {
    if (isGridRowEmpty(row)) continue;
    const rowIssues = validateLeadRow(row.values, {
      existingEmails: options.existingEmails,
      seenEmails: seen,
    });
    if (rowIssues.length > 0) issues.set(row.id, rowIssues);
    const email = normalizeEmail(row.values.email ?? "");
    if (email) seen.add(email);
  }

  return issues;
}

export function gridCounts(
  grid: LeadGrid,
  options: ValidateRowOptions = {},
): GridCounts {
  const issues = gridRowIssues(grid, options);
  let total = 0;
  let empty = 0;
  let ready = 0;
  let invalid = 0;
  let duplicate = 0;

  for (const row of grid.rows) {
    if (isGridRowEmpty(row)) {
      empty += 1;
      continue;
    }
    total += 1;
    const rowIssues = issues.get(row.id) ?? [];
    const blocking = rowIssues.filter(isBlockingIssue);
    const duplicates = rowIssues.filter((issue) => !isBlockingIssue(issue));
    if (blocking.length > 0) invalid += 1;
    else if (duplicates.length > 0) duplicate += 1;
    else ready += 1;
  }

  return { total, ready, invalid, duplicate, empty };
}

/** The rows that will be sent to the api. */
export function gridToPayloads(
  grid: LeadGrid,
  options: ValidateRowOptions = {},
): LeadPayload[] {
  const issues = gridRowIssues(grid, options);
  const payloads: LeadPayload[] = [];

  for (const row of grid.rows) {
    if (isGridRowEmpty(row)) continue;
    const rowIssues = issues.get(row.id) ?? [];
    if (rowIssues.some(isBlockingIssue)) continue;
    if (rowIssues.some((issue) => issue.code.startsWith("duplicate"))) continue;
    payloads.push(gridRowToPayload(grid, row));
  }

  return payloads;
}

/** Assigns one built-in field on a payload, keeping the types honest. */
function assignField(payload: LeadPayload, key: LeadColumnKey, value: string): void {
  switch (key) {
    case "email":
      payload.email = value;
      return;
    case "firstName":
      payload.firstName = value;
      return;
    case "lastName":
      payload.lastName = value;
      return;
    case "company":
      payload.company = value;
      return;
    case "title":
      payload.title = value;
      return;
    case "phone":
      payload.phone = value;
      return;
    case "linkedinUrl":
      payload.linkedinUrl = value;
      return;
    case "photoUrl":
      payload.photoUrl = value;
      return;
  }
}

/** One row as the api expects it. Custom columns ride along as variables. */
export function gridRowToPayload(
  grid: LeadGrid,
  row: LeadGridRow,
): LeadPayload {
  const payload: LeadPayload = { email: normalizeEmail(row.values.email ?? "") };
  const customVariables: Record<string, string> = {};

  for (const column of grid.columns) {
    if (column.key === "email") continue;
    const value = (row.values[column.key] ?? "").trim();
    if (!value) continue;
    if (column.custom) {
      customVariables[column.key] = value;
      continue;
    }
    assignField(payload, column.key as LeadColumnKey, value);
  }

  if (Object.keys(customVariables).length > 0) {
    payload.customVariables = customVariables;
  }
  return payload;
}

/** Drops every row with a blocking problem. */
export function removeInvalidGridRows(
  grid: LeadGrid,
  options: ValidateRowOptions = {},
): LeadGrid {
  const issues = gridRowIssues(grid, options);
  return {
    ...grid,
    rows: grid.rows.filter((row) => {
      const rowIssues = issues.get(row.id) ?? [];
      return !rowIssues.some(isBlockingIssue);
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Files                                                                       */
/* -------------------------------------------------------------------------- */

/** The file types the importer accepts. */
export const IMPORT_FILE_EXTENSIONS = [".csv", ".tsv", ".txt"] as const;

/** The largest file we will read in the browser (5 MB). */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

const TEXT_MIME_TYPES = [
  "text/csv",
  "text/plain",
  "text/tab-separated-values",
  "application/csv",
  "application/vnd.ms-excel",
];

/**
 * Why a file cannot be imported, or null when it can.
 *
 * The browser cannot trust a dropped file: it may be a pdf, it may be huge,
 * it may be empty. Saying so plainly beats a silent no-op.
 */
export function importFileError(
  fileName: string,
  sizeBytes: number,
  mimeType?: string,
): string | null {
  const lower = fileName.toLowerCase();
  const hasKnownExtension = IMPORT_FILE_EXTENSIONS.some((extension) =>
    lower.endsWith(extension),
  );
  const isText =
    mimeType !== undefined && TEXT_MIME_TYPES.includes(mimeType.toLowerCase());

  if (!hasKnownExtension && !isText) {
    return `\"${fileName}\" is not a CSV or text file. Drop a .csv, .tsv or .txt file.`;
  }
  if (sizeBytes === 0) {
    return `\"${fileName}\" is empty.`;
  }
  if (sizeBytes > MAX_IMPORT_FILE_BYTES) {
    const megabytes = Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024));
    return `\"${fileName}\" is larger than ${megabytes} MB. Split it and import it in parts.`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Delimited text parsing                                                      */
/* -------------------------------------------------------------------------- */

const DELIMITERS = [",", ";", "\t", "|"] as const;

/** Counts a delimiter outside of quoted sections. */
function countDelimiter(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) count += 1;
  }
  return count;
}

/**
 * Guesses the delimiter of a pasted file: whichever of `,` `;` tab `|` shows
 * up most often on the first non-empty line.
 */
export function detectDelimiter(text: string): string {
  const line =
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .find((candidate) => candidate.trim() !== "") ?? "";
  let best = ",";
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = countDelimiter(line, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parses delimited text into rows of cells.
 *
 * Handles quoted fields, escaped quotes (`""`), embedded newlines, CRLF and
 * a leading byte-order mark.
 */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Header aliases we recognise, per built-in field. */
export const LEAD_HEADER_ALIASES: Record<LeadColumnKey, string[]> = {
  email: [
    "email",
    "e-mail",
    "email address",
    "emailaddress",
    "work email",
    "company email",
    "mail",
  ],
  firstName: [
    "firstname",
    "first name",
    "first_name",
    "first",
    "fname",
    "given name",
    "givenname",
  ],
  lastName: [
    "lastname",
    "last name",
    "last_name",
    "last",
    "lname",
    "surname",
    "family name",
  ],
  company: [
    "company",
    "organisation",
    "organization",
    "org",
    "account",
    "employer",
    "business",
  ],
  title: ["title", "job title", "jobtitle", "role", "position"],
  phone: ["phone", "phone number", "mobile", "mobile number", "cell", "telephone", "tel"],
  linkedinUrl: [
    "linkedin",
    "linkedin url",
    "linkedinurl",
    "linkedin profile",
    "linkedin profile url",
    "li url",
  ],
  photoUrl: [
    "photo",
    "photo url",
    "photourl",
    "avatar",
    "avatar url",
    "profile photo",
    "profile picture",
    "image",
    "image url",
    "picture",
    "picture url",
  ],
};

/** Normalises a header cell for matching: lower case, no separators. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** The built-in field a header names, if any. */
export function detectTargetKey(header: string): LeadColumnKey | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const key of LEAD_COLUMN_KEYS) {
    const aliases = LEAD_HEADER_ALIASES[key].map(normalizeHeader);
    if (aliases.includes(normalized)) return key;
  }
  return null;
}

/** The built-in field each column of a header row maps to. */
export function mapHeaders(headers: string[]): (LeadColumnKey | null)[] {
  return headers.map((header) => detectTargetKey(header));
}

export interface ParsedTable {
  /** The header row, when the text had one. */
  headers: string[] | null;
  /** The data rows (the header is not repeated here). */
  rows: string[][];
  delimiter: string;
}

/** True when a row looks like a header rather than data. */
export function looksLikeHeader(row: string[]): boolean {
  return row.some((cell) => detectTargetKey(cell) !== null);
}

/** Parses pasted or dropped text into a header plus rows. */
export function parseTable(text: string): ParsedTable {
  const delimiter = detectDelimiter(text);
  const parsed = parseDelimited(text, delimiter).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  if (parsed.length === 0) return { headers: null, rows: [], delimiter };

  const [first, ...rest] = parsed as [string[], ...string[][]];
  if (looksLikeHeader(first)) {
    return { headers: first.map((cell) => cell.trim()), rows: rest, delimiter };
  }
  return { headers: null, rows: parsed, delimiter };
}

export interface ParsedLeads {
  leads: LeadPayload[];
  /** Headers we did not recognise and dropped. */
  unmapped: string[];
  /** Rows without a usable email. */
  skipped: number;
}

/**
 * Turns parsed text into leads.
 *
 * With a header row the columns are matched by name; without one they are
 * positional (email, first name, last name, company, title, phone, LinkedIn
 * URL, photo URL).
 */
export function tableToLeads(table: ParsedTable): ParsedLeads {
  const leads: LeadPayload[] = [];
  const unmapped: string[] = [];
  let skipped = 0;

  if (table.headers) {
    const mapping = mapHeaders(table.headers);
    mapping.forEach((key, index) => {
      if (key === null) {
        const header = table.headers?.[index];
        if (header) unmapped.push(header);
      }
    });

    for (const row of table.rows) {
      const payload: LeadPayload = { email: "" };
      mapping.forEach((key, index) => {
        const value = (row[index] ?? "").trim();
        if (!value) return;
        if (key === null) return;
        assignField(payload, key, key === "email" ? normalizeEmail(value) : value);
      });
      if (!payload.email) {
        skipped += 1;
        continue;
      }
      leads.push(payload);
    }

    return { leads, unmapped, skipped };
  }

  const positional: LeadColumnKey[] = [
    "email",
    "firstName",
    "lastName",
    "company",
    "title",
    "phone",
    "linkedinUrl",
    "photoUrl",
  ];
  for (const row of table.rows) {
    const payload: LeadPayload = { email: "" };
    positional.forEach((key, index) => {
      const value = (row[index] ?? "").trim();
      if (!value) return;
      assignField(payload, key, key === "email" ? normalizeEmail(value) : value);
    });
    if (!payload.email) {
      skipped += 1;
      continue;
    }
    leads.push(payload);
  }

  return { leads, unmapped, skipped };
}

/** Parses text straight into leads. */
export function parseLeadsText(text: string): ParsedLeads {
  return tableToLeads(parseTable(text));
}

/* -------------------------------------------------------------------------- */
/* Pasting into the grid                                                       */
/* -------------------------------------------------------------------------- */

/** A column key that is safe to use as a custom variable name. */
export function slugifyKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "custom_field";
}

export interface PasteAnchor {
  /** The row the paste starts on. */
  rowId: string;
  /** The column index the paste starts at. */
  columnIndex: number;
}

export interface PasteResult {
  grid: LeadGrid;
  /** How many rows were written. */
  pastedRows: number;
  /** True when the clipboard had a header row we could map by name. */
  mappedFromHeader: boolean;
  /** Columns added because the clipboard had headers we did not have. */
  addedColumns: string[];
}

/**
 * Pastes clipboard text into the grid.
 *
 * A clipboard with a header row is mapped by name: "Work email" lands in the
 * email column, "LinkedIn URL" becomes a new custom column. A clipboard
 * without headers is pasted positionally from the focused cell.
 */
export function pasteIntoGrid(
  grid: LeadGrid,
  text: string,
  anchor: PasteAnchor,
  makeId: () => string,
): PasteResult {
  const table = parseTable(text);
  let next = grid;
  const addedColumns: string[] = [];

  // Which grid column does clipboard column N land in?
  let targetColumns: (string | null)[];
  let headerMapped = false;

  if (table.headers) {
    headerMapped = true;
    targetColumns = table.headers.map((header) => {
      const key = detectTargetKey(header);
      if (key) {
        return next.columns.some((column) => column.key === key)
          ? key
          : null;
      }
      // An unknown header becomes a custom column.
      const slug = slugifyKey(header);
      if (!slug) return null;
      if (!next.columns.some((column) => column.key === slug)) {
        next = addGridColumn(next, {
          key: slug,
          label: header.trim() || slug,
          custom: true,
        });
        addedColumns.push(slug);
      }
      return slug;
    });
  } else {
    // No header: the cells land in the grid columns, starting at the anchor.
    targetColumns = table.rows[0]
      ? table.rows[0].map(
          (_, index) => next.columns[anchor.columnIndex + index]?.key ?? null,
        )
      : [];
  }

  const anchorIndex = next.rows.findIndex((row) => row.id === anchor.rowId);
  const startIndex = anchorIndex < 0 ? next.rows.length - 1 : anchorIndex;

  const rows = [...next.rows];
  const pasteRows = table.rows;

  // Make sure there is a row for every pasted line.
  const needed = startIndex + pasteRows.length;
  while (rows.length < needed) rows.push(createGridRow(makeId()));

  pasteRows.forEach((cells, rowOffset) => {
    const row = rows[startIndex + rowOffset];
    if (!row) return;
    const values = { ...row.values };
    cells.forEach((cell, cellOffset) => {
      const key = targetColumns[cellOffset] ?? null;
      if (!key) return;
      const value = cell.trim();
      if (!value) return;
      values[key] = value;
    });
    rows[startIndex + rowOffset] = { ...row, values };
  });

  return {
    grid: { ...next, rows },
    pastedRows: pasteRows.length,
    mappedFromHeader: headerMapped,
    addedColumns,
  };
}

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                    */
/* -------------------------------------------------------------------------- */

export type GridKeyAction =
  | { type: "move"; rowId: string; columnIndex: number }
  | { type: "import" }
  | { type: "clear-row"; rowId: string }
  | { type: "duplicate-row"; rowId: string }
  | { type: "none" };

export interface GridKeyContext {
  /** The row the event happened in. */
  rowId: string;
  /** The column index the event happened in. */
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  /** The ids of every row, in order — needed to resolve the next row. */
  rowIds: string[];
  /** The index of `rowId` inside `rowIds`. */
  rowIndex: number;
}

export interface GridKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * What a keystroke means inside the grid.
 *
 * Tab and Shift+Tab move between cells (never through the row buttons),
 * Enter moves down, the arrow keys move around, Cmd/Ctrl+Enter imports,
 * Cmd/Ctrl+Backspace clears the row and Cmd/Ctrl+D duplicates it.
 */
export function gridKeyAction(
  event: GridKeyEvent,
  context: GridKeyContext,
): GridKeyAction {
  const mod = event.metaKey || event.ctrlKey;

  if (mod && event.key === "Enter") return { type: "import" };
  if (mod && event.key === "Backspace") return { type: "clear-row", rowId: context.rowId };
  if (mod && (event.key === "d" || event.key === "D")) {
    return { type: "duplicate-row", rowId: context.rowId };
  }
  if (mod) return { type: "none" };

  const { rowId, columnIndex, columnCount } = context;

  if (event.key === "Tab") {
    const forward = !event.shiftKey;
    const nextColumn = columnIndex + (forward ? 1 : -1);
    if (nextColumn >= columnCount) {
      const nextRow = nextRowId(context, 1);
      if (!nextRow) return { type: "none" };
      return { type: "move", rowId: nextRow, columnIndex: 0 };
    }
    if (nextColumn < 0) {
      const nextRow = nextRowId(context, -1);
      if (!nextRow) return { type: "none" };
      return { type: "move", rowId: nextRow, columnIndex: columnCount - 1 };
    }
    return { type: "move", rowId: context.rowId, columnIndex: nextColumn };
  }

  if (event.key === "Enter") {
    const nextRow = nextRowId(context, 1);
    if (!nextRow) return { type: "none" };
    return { type: "move", rowId: nextRow, columnIndex };
  }

  if (event.key === "ArrowDown") {
    const nextRow = nextRowId(context, 1);
    if (!nextRow) return { type: "none" };
    return { type: "move", rowId: nextRow, columnIndex };
  }

  if (event.key === "ArrowUp") {
    const nextRow = nextRowId(context, -1);
    if (!nextRow) return { type: "none" };
    return { type: "move", rowId: nextRow, columnIndex };
  }

  if (event.key === "ArrowRight") {
    if (columnIndex + 1 >= columnCount) return { type: "none" };
    return { type: "move", rowId, columnIndex: columnIndex + 1 };
  }

  if (event.key === "ArrowLeft") {
    if (columnIndex - 1 < 0) return { type: "none" };
    return { type: "move", rowId, columnIndex: columnIndex - 1 };
  }

  return { type: "none" };
}

/** The id of the row `offset` rows away from the one in the context. */
function nextRowId(context: GridKeyContext, offset: number): string | null {
  const next = context.rowIndex + offset;
  if (next < 0 || next >= context.rowCount) return null;
  return context.rowIds[next] ?? null;
}
