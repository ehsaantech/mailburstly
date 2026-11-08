import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { FileDropZone } from "./FileDropZone";

/**
 * The drop half of the import modal.
 *
 * A file can arrive by button or by drag; both have to end up in the
 * textarea, and a file that is not a csv has to say so instead of failing
 * silently.
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

/** A file that reads as text, like a csv from the disk. */
function textFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

function dropFile(target: HTMLElement, file: File) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files: [file], types: ["Files"] },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

async function flush() {
  // FileReader hands the text back in a later task, not a microtask.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("FileDropZone", () => {
  test("loads a dropped file into the textarea", async () => {
    let text = "";
    const { container, unmount } = render(
      <FileDropZone
        value={text}
        onChange={(next) => {
          text = next;
        }}
        onError={() => {}}
        count={0}
      />,
    );

    const zone = container.querySelector("div")!;
    dropFile(zone, textFile("leads.csv", "email\njane@acme.com"));
    await flush();

    expect(text).toBe("email\njane@acme.com");
    unmount();
  });

  test("refuses a file that is not a csv and says why", async () => {
    const errors: string[] = [];
    const { container, unmount } = render(
      <FileDropZone
        value=""
        onChange={() => {}}
        onError={(message) => {
          if (message) errors.push(message);
        }}
        count={0}
      />,
    );

    const zone = container.querySelector("div")!;
    const pdf = new File(["%PDF"], "deck.pdf", { type: "application/pdf" });
    dropFile(zone, pdf);
    await flush();

    expect(errors.join(" ")).toContain("not a CSV");
    unmount();
  });

  test("shows the drop state while a file is dragged over it", () => {
    const { container, unmount } = render(
      <FileDropZone value="" onChange={() => {}} onError={() => {}} count={0} />,
    );

    const zone = container.querySelector("div")!;
    act(() => {
      zone.dispatchEvent(
        new Event("dragenter", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain("Drop to import");

    act(() => {
      zone.dispatchEvent(
        new Event("dragleave", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).not.toContain("Drop to import");
    unmount();
  });
});
