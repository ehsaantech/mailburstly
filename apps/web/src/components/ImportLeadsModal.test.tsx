import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The import modal.
 *
 * The api is stubbed: the point of these tests is what the modal sends and
 * what it tells the operator, not what the api does with it.
 */
const calls: { path: string; body: unknown }[] = [];

mock.module("@/lib/api", () => ({
  api: {
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      return {
        data: {
          created: 1,
          skipped: 0,
          rejected: 1,
          leadIds: ["lead-1"],
          errors: [
            {
              row: 2,
              email: "broken",
              code: "email_invalid",
              message: '"broken" is not a valid email',
            },
          ],
        },
      };
    },
    get: async () => ({ data: {} }),
    patch: async () => ({ data: {} }),
    put: async () => ({ data: {} }),
    delete: async () => ({ data: {} }),
  },
}));

const { ImportLeadsModal } = await import("./ImportLeadsModal");

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
    );
  });
  return {
    container,
    unmount: () =>
      act(() => {
        root.unmount();
      }),
  };
}

function type(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("ImportLeadsModal", () => {
  test("shows the broken rows and leaves them out of the request", async () => {
    calls.length = 0;
    const { unmount } = render(<ImportLeadsModal open onClose={() => {}} />);

    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    type(textarea, "email\njane@acme.com\nbroken");

    const body = document.body.textContent ?? "";
    expect(body).toContain("1 ready");
    expect(body).toContain("1 invalid");
    expect(body).toContain("is not a valid email");

    const importButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Import"),
    ) as HTMLButtonElement;
    act(() => {
      importButton.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/leads/import");
    expect((calls[0]!.body as { leads: { email: string }[] }).leads).toEqual([
      { email: "jane@acme.com" },
    ]);
    unmount();
  });

  test("reports the rows the api rejected", async () => {
    calls.length = 0;
    const { unmount } = render(<ImportLeadsModal open onClose={() => {}} />);

    const textarea = document.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    type(textarea, "email\njane@acme.com");

    const importButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Import"),
    ) as HTMLButtonElement;
    act(() => {
      importButton.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await flush();

    const body = document.body.textContent ?? "";
    expect(body).toContain("1 created");
    expect(body).toContain("1 row rejected");
    expect(body).toContain("broken");
    unmount();
  });

  test("offers the manual table as a second way in", () => {
    const { unmount } = render(<ImportLeadsModal open onClose={() => {}} />);

    const tableTab = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Manual table",
    ) as HTMLButtonElement;
    act(() => {
      tableTab.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(document.querySelector("table")).toBeTruthy();
    expect(document.body.textContent).toContain("Add row");
    unmount();
  });
});
