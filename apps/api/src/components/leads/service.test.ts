import { describe, expect, test } from "bun:test";

import type { LeadRepository, LeadRow } from "./repository";
import { createLeadService } from "./service";

/**
 * A lead repository that lives in a Map.
 *
 * The import policy is the thing under test — one broken email must not
 * fail the rest of the batch — and that policy is easier to see without a
 * database in the way.
 */
function fakeRepository(existing: { email: string; id: string }[] = []) {
  const store = new Map<string, LeadRow>();
  let counter = 0;

  for (const row of existing) {
    store.set(row.email.toLowerCase(), {
      id: row.id,
      workspaceId: "ws",
      email: row.email.toLowerCase(),
      firstName: null,
      lastName: null,
      company: null,
      title: null,
      phone: null,
      linkedinUrl: null,
      photoUrl: null,
      statusId: null,
      emailStatus: "unknown",
      verificationScore: null,
      customVariables: {},
      ownerId: null,
      oooUntil: null,
      unsubscribed: 0,
      createdAt: new Date(),
      lastActivityAt: null,
    } as LeadRow);
  }

  const repository = {
    async byEmail(_workspaceId: string, email: string) {
      return store.get(email.toLowerCase()) ?? null;
    },
    async create(input: {
      workspaceId: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      company?: string | null;
      title?: string | null;
      phone?: string | null;
      linkedinUrl?: string | null;
      photoUrl?: string | null;
      statusId?: number | null;
      customVariables?: Record<string, string>;
    }) {
      counter += 1;
      const row = {
        id: `lead-${counter}`,
        workspaceId: input.workspaceId,
        email: input.email.toLowerCase(),
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        company: input.company ?? null,
        title: input.title ?? null,
        phone: input.phone ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        photoUrl: input.photoUrl ?? null,
        statusId: input.statusId ?? null,
        emailStatus: "unknown",
        verificationScore: null,
        customVariables: input.customVariables ?? {},
        ownerId: null,
        oooUntil: null,
        unsubscribed: 0,
        createdAt: new Date(),
        lastActivityAt: null,
      } as LeadRow;
      store.set(row.email, row);
      return row;
    },
  } as unknown as LeadRepository;

  return { repository, store };
}

function service(repository: LeadRepository) {
  return createLeadService({ workspaceId: "ws", repository });
}

describe("importLeads", () => {
  test("creates every valid lead", async () => {
    const { repository } = fakeRepository();
    const leads = service(repository);

    const result = await leads.importLeads({
      leads: [
        { email: "jane@acme.com", firstName: "Jane" },
        { email: "john@beta.io", firstName: "John" },
      ],
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.leadIds).toHaveLength(2);
  });

  test("rejects one broken email and imports the rest", async () => {
    const { repository } = fakeRepository();
    const leads = service(repository);

    const result = await leads.importLeads({
      leads: [
        { email: "jane@acme.com" },
        { email: "not-an-email" },
        { email: "john@beta.io" },
      ],
    });

    expect(result.created).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.row).toBe(2);
    expect(result.errors[0]!.email).toBe("not-an-email");
    expect(result.errors[0]!.code).toBe("email_invalid");
    expect(result.errors[0]!.message).toContain("not a valid email");
  });

  test("rejects an email that is longer than 255 characters", async () => {
    const { repository } = fakeRepository();
    const leads = service(repository);

    const long = `${"a".repeat(300)}@acme.com`;
    const result = await leads.importLeads({
      leads: [{ email: long }, { email: "jane@acme.com" }],
    });

    expect(result.created).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.errors[0]!.code).toBe("email_too_long");
    expect(result.errors[0]!.message).toContain("255");
  });

  test("rejects a row with no email at all", async () => {
    const { repository } = fakeRepository();
    const leads = service(repository);

    const result = await leads.importLeads({
      leads: [{ email: "" }, { email: "jane@acme.com" }],
    });

    expect(result.created).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.errors[0]!.code).toBe("email_required");
  });

  test("skips a lead that already exists instead of failing", async () => {
    const { repository } = fakeRepository([{ email: "jane@acme.com", id: "lead-existing" }]);
    const leads = service(repository);

    const result = await leads.importLeads({
      leads: [{ email: "jane@acme.com" }, { email: "john@beta.io" }],
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rejected).toBe(0);
    // The existing lead is still returned, so a campaign can enrol it.
    expect(result.leadIds).toContain("lead-existing");
  });

  test("skips the second copy of an email inside one batch", async () => {
    const { repository } = fakeRepository();
    const leads = service(repository);

    const result = await leads.importLeads({
      leads: [{ email: "jane@acme.com" }, { email: "JANE@acme.com" }],
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rejected).toBe(0);
  });

  test("stores the email lower-cased and trimmed", async () => {
    const { repository, store } = fakeRepository();
    const leads = service(repository);

    await leads.importLeads({ leads: [{ email: "  Jane@Acme.COM " }] });

    expect([...store.keys()]).toEqual(["jane@acme.com"]);
  });

  test("keeps the custom variables a sheet brought along", async () => {
    const { repository, store } = fakeRepository();
    const leads = service(repository);

    await leads.importLeads({
      leads: [
        {
          email: "jane@acme.com",
          customVariables: { linkedin_url: "https://li/jane", seats: 12 },
        },
      ],
    });

    const row = store.get("jane@acme.com")!;
    expect(row.customVariables).toEqual({
      linkedin_url: "https://li/jane",
      seats: "12",
    });
  });

  test("keeps LinkedIn and photo URLs", async () => {
    const { repository, store } = fakeRepository();
    const leads = service(repository);

    await leads.importLeads({
      leads: [
        {
          email: "jane@acme.com",
          linkedinUrl: "https://www.linkedin.com/in/jane",
          photoUrl: "https://cdn.acme.com/jane.jpg",
        },
      ],
    });

    const row = store.get("jane@acme.com")!;
    expect(row.linkedinUrl).toBe("https://www.linkedin.com/in/jane");
    expect(row.photoUrl).toBe("https://cdn.acme.com/jane.jpg");
  });

  test("reports the row number of every rejected row", async () => {
    const { repository } = fakeRepository();
    const leads = service(repository);

    const result = await leads.importLeads({
      leads: [
        { email: "jane@acme.com" },
        { email: "broken-one" },
        { email: "john@beta.io" },
        { email: "broken-two" },
      ],
    });

    expect(result.errors.map((error) => error.row)).toEqual([2, 4]);
    expect(result.created).toBe(2);
  });

  test("an empty batch is a bad request, not a crash", async () => {
    const { repository } = fakeRepository();
    const leads = service(repository);

    const result = await leads.importLeads({ leads: [] });
    expect(result.created).toBe(0);
  });
});
