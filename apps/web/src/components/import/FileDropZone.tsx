import { useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { importFileError } from "@mailrung/shared";

import { cn } from "@/lib/cn";

/**
 * The file half of the import modal.
 *
 * A file can arrive two ways: the **Choose file** button, or dropped
 * straight onto the area. Both go through `loadFile`, so a dropped file
 * behaves exactly like a picked one — the text lands in the textarea and
 * the lead count updates.
 */
export function FileDropZone({
  value,
  onChange,
  onError,
  count,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  onError: (message: string | null) => void;
  /** How many leads the current text holds. */
  count: number;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Drag events fire for every child element, so the counter keeps the
  // highlight on while the pointer is still inside the zone.
  const dragDepth = useRef(0);

  const loadFile = (file: File) => {
    const problem = importFileError(file.name, file.size, file.type);
    if (problem) {
      onError(problem);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      onError(`Could not read "${file.name}".`);
    };
    reader.onload = () => {
      onChange(String(reader.result ?? ""));
      onError(null);
    };
    reader.readAsText(file);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    if (files.length > 1) {
      onError(
        `Dropped ${files.length} files. Drop one at a time — "${files[0]!.name}" was used.`,
      );
    }
    loadFile(files[0]!);
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed p-3 transition-colors",
        dragging ? "border-accent bg-accent/5" : "border-border",
        disabled && "pointer-events-none opacity-60",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        // Without this the browser opens the file instead of dropping it.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-muted"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          <FileText className="h-3.5 w-3.5" />
          Choose file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) loadFile(file);
          }}
        />
        <span className="text-xs text-fg-subtle">
          {count > 0
            ? `${count} lead${count === 1 ? "" : "s"} detected`
            : "No leads detected yet"}
        </span>
        {dragging ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg">
            <Upload className="h-3.5 w-3.5" />
            Drop to import
          </span>
        ) : (
          <span className="text-xs text-fg-subtle">
            or drag a CSV here
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`email,firstName,lastName,company,title,linkedinUrl,photoUrl\njane@acme.com,Jane,Doe,Acme,VP Sales,https://linkedin.com/in/jane,https://acme.com/jane.jpg\njohn@beta.io,John,Smith,Beta,Founder,,`}
        className="h-48 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
      />
    </div>
  );
}
