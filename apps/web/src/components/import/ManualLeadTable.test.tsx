import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { LeadPayload } from "@mailrung/shared";

import { ManualLeadTable } from "./ManualLeadTable";

/**
 * The manual table.
 *
 * The operator types, pastes, fixes and removes rows here, so the tests
 * drive the same things a person would: typing in a cell, pasting a block
 * from a spreadsheet, pressing Tab, pressing Cmd+Enter.
 */

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    unmount: () =>
      act(() => {
        root.unmount();
      }),
  };
}

/** Types into a controlled input the way React expects. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
  });
}

function focus(input: HTMLInputElement) {
  act(() => {
    input.focus();
  });
}

function paste(target: HTMLElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

function cells(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll("input[aria-label]")].filter(
    (input) => input.getAttribute("aria-label") !== "New column label",
  ) as HTMLInputElement[];
}

function emailCell(container: HTMLElement, row: number): HTMLInputElement {
  return cells(container).find((input) =>
    input.getAttribute("aria-label") === `Email row ${row}`,
  )!;
}

describe("ManualLeadTable", () => {
  test("counts a row as ready once its email is valid", () => {
    const { container, unmount } = render(
      <ManualLeadTable onImport={() => {}} />,
    );

    type(emailCell(container, 1), "jane@acme.com");
    blur(emailCell(container, 1));

    expect(container.textContent).toContain("1 ready");
    unmount();
  });

  test("keeps a broken email out of the import and says why", () => {
    let imported: LeadPayload[] = [];
    const { container, unmount } = render(
      <ManualLeadTable onImport={(payloads) => (imported = payloads)} />,
    );

    type(emailCell(container, 1), "jane@acme.com");
    type(emailCell(container, 2), "broken");

    blur(emailCell(container, 2));

    expect(container.textContent).toContain("1 ready");
    expect(container.textContent).toContain("1 invalid");

    // The bad row stays on screen — the operator can fix it — but it is not
    // part of the request.
    act(() => {
      container
        .querySelector("button[aria-label='Delete row 2']")!
        .dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(imported).toEqual([]);
    unmount();
  });

  test("sends the valid rows when the import runs", () => {
    let imported: LeadPayload[] = [];
    const { container, unmount } = render(
      <ManualLeadTable onImport={(payloads) => (imported = payloads)} />,
    );

    type(emailCell(container, 1), "Jane@Acme.com");
    type(emailCell(container, 2), "broken");

    const importButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add row",
    )!;
    // The grid imports on Cmd+Enter; the modal owns the button.
    const grid = container.querySelector("table")!;
    focus(emailCell(container, 1));
    press(grid, "Enter", { metaKey: true });

    expect(imported).toHaveLength(1);
    expect(imported[0]!.email).toBe("jane@acme.com");
    expect(importButton).toBeTruthy();
    unmount();
  });

  test("flags the second copy of an email as a duplicate", () => {
    const { container, unmount } = render(
      <ManualLeadTable onImport={() => {}} />,
    );

    type(emailCell(container, 1), "jane@acme.com");
    type(emailCell(container, 2), "jane@acme.com");
    blur(emailCell(container, 2));

    expect(container.textContent).toContain("1 duplicate");
    unmount();
  });

  test("pastes a block from a spreadsheet into the rows", () => {
    const { container, unmount } = render(
      <ManualLeadTable onImport={() => {}} />,
    );

    const grid = container.querySelector("table")!;
    focus(emailCell(container, 1));
    paste(
      grid,
      "Work email,Given name,Company\njane@acme.com,Jane,Acme\njohn@beta.io,John,Beta",
    );

    expect(emailCell(container, 1).value).toBe("jane@acme.com");
    expect(emailCell(container, 2).value).toBe("john@beta.io");
    expect(container.textContent).toContain("2 ready");
    unmount();
  });

  test("moves to the next cell with Tab", () => {
    const { container, unmount } = render(
      <ManualLeadTable onImport={() => {}} />,
    );

    const grid = container.querySelector("table")!;
    const first = emailCell(container, 1);
    focus(first);
    press(grid, "Tab");

    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "First name row 1",
    );
    unmount();
  });

  test("clears the row with Cmd+Backspace", () => {
    const { container, unmount } = render(
      <ManualLeadTable onImport={() => {}} />,
    );

    const grid = container.querySelector("table")!;
    type(emailCell(container, 1), "jane@acme.com");
    focus(emailCell(container, 1));
    press(grid, "Backspace", { metaKey: true });

    expect(emailCell(container, 1).value).toBe("");
    unmount();
  });

  test("removes the invalid rows in one go", () => {
    const { container, unmount } = render(
      <ManualLeadTable onImport={() => {}} />,
    );

    type(emailCell(container, 1), "jane@acme.com");
    type(emailCell(container, 2), "broken");
    blur(emailCell(container, 2));

    const removeInvalid = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Remove invalid rows"),
    ) as HTMLButtonElement;
    act(() => {
      removeInvalid.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("1 ready");
    expect(container.textContent).not.toContain("1 invalid");
    unmount();
  });
});
