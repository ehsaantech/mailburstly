import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  Plus,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  addGridColumn,
  addGridRows,
  clearGridRow,
  createLeadGrid,
  duplicateGridRow,
  gridCounts,
  gridKeyAction,
  gridRowIssues,
  gridToPayloads,
  insertGridRow,
  isBlockingIssue,
  normalizeGridEmails,
  pasteIntoGrid,
  removeGridColumn,
  removeGridRow,
  removeInvalidGridRows,
  slugifyKey,
  updateGridCell,
  type GridCounts,
  type LeadGrid,
  type LeadGridColumn,
  type LeadPayload,
} from "@mailrung/shared";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

/**
 * The manual half of the import modal: an editable grid.
 *
 * The operator can type a lead, paste fifty rows from a spreadsheet, fix a
 * broken address and remove the rows they do not want — then send the lot
 * in one request. Every rule the grid applies (email shape, duplicates,
 * phone sanity) comes from `@mailrung/shared`, so the api agrees with what
 * the operator sees.
 */
export function ManualLeadTable({
  onImport,
  onStateChange,
  initialRows = 5,
  existingEmails,
}: {
  onImport: (payloads: LeadPayload[]) => void;
  /** Reports what would be imported, so the modal can label its button. */
  onStateChange?: (state: {
    payloads: LeadPayload[];
    counts: GridCounts;
  }) => void;
  /** How many blank rows to start with. */
  initialRows?: number;
  /** Emails that already exist in the workspace, for duplicate warnings. */
  existingEmails?: string[];
}) {
  const counter = useRef(0);
  const makeId = useCallback(() => `row-${++counter.current}`, []);

  const [grid, setGrid] = useState<LeadGrid>(() =>
    createLeadGrid(initialRows, makeId),
  );
  /** Rows the operator has left at least once — only those show errors. */
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState<{
    rowId: string;
    columnIndex: number;
  } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{
    rowId: string;
    columnIndex: number;
  } | null>(null);
  const [newColumn, setNewColumn] = useState("");

  const inputs = useRef(new Map<string, HTMLInputElement>());

  const issues = useMemo(
    () => gridRowIssues(grid, { existingEmails }),
    [grid, existingEmails],
  );
  const counts = useMemo(
    () => gridCounts(grid, { existingEmails }),
    [grid, existingEmails],
  );

  const cellKey = useCallback(
    (rowId: string, columnKey: string) => `${rowId}::${columnKey}`,
    [],
  );

  const focusCell = useCallback(
    (rowId: string, columnIndex: number) => {
      const column = grid.columns[columnIndex];
      if (!column) return;
      const element = inputs.current.get(cellKey(rowId, column.key));
      element?.focus();
      element?.select();
    },
    [cellKey, grid.columns],
  );

  useEffect(() => {
    if (!pendingFocus) return;
    focusCell(pendingFocus.rowId, pendingFocus.columnIndex);
    setPendingFocus(null);
  }, [pendingFocus, focusCell]);

  const touch = (rowId: string) =>
    setTouched((current) => {
      if (current.has(rowId)) return current;
      const next = new Set(current);
      next.add(rowId);
      return next;
    });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    if (!focus) return;
    const rowIndex = grid.rows.findIndex((row) => row.id === focus.rowId);
    if (rowIndex < 0) return;

    const action = gridKeyAction(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      },
      {
        rowId: focus.rowId,
        columnIndex: focus.columnIndex,
        rowCount: grid.rows.length,
        columnCount: grid.columns.length,
        rowIds: grid.rows.map((row) => row.id),
        rowIndex,
      },
    );

    if (action.type === "none") return;
    event.preventDefault();

    if (action.type === "move") {
      setPendingFocus({ rowId: action.rowId, columnIndex: action.columnIndex });
      return;
    }
    if (action.type === "import") {
      onImport(gridToPayloads(grid, { existingEmails }));
      return;
    }
    if (action.type === "clear-row") {
      setGrid((current) => clearGridRow(current, action.rowId));
      return;
    }
    if (action.type === "duplicate-row") {
      setGrid((current) => duplicateGridRow(current, action.rowId, makeId));
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTableElement>) => {
    if (!focus) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();

    const result = pasteIntoGrid(
      grid,
      text,
      { rowId: focus.rowId, columnIndex: focus.columnIndex },
      makeId,
    );
    setGrid(result.grid);
    setTouched((current) => {
      const next = new Set(current);
      for (const row of result.grid.rows) next.add(row.id);
      return next;
    });
  };

  const addColumn = () => {
    const label = newColumn.trim();
    if (!label) return;
    const column: LeadGridColumn = {
      key: slugifyKey(label),
      label,
      custom: true,
    };
    setGrid((current) => addGridColumn(current, column));
    setNewColumn("");
  };

  const payloads = useMemo(
    () => gridToPayloads(grid, { existingEmails }),
    [grid, existingEmails],
  );

  useEffect(() => {
    onStateChange?.({ payloads, counts });
  }, [onStateChange, payloads, counts]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setGrid((current) => addGridRows(current, 1, makeId))}
        >
          <Plus className="h-3.5 w-3.5" />
          Add row
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setGrid((current) => addGridRows(current, 10, makeId))}
        >
          Add 10 rows
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setGrid((current) => normalizeGridEmails(current))}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Fix all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={counts.invalid === 0}
          onClick={() =>
            setGrid((current) =>
              removeInvalidGridRows(current, { existingEmails }),
            )
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove invalid rows
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            value={newColumn}
            onChange={(event) => setNewColumn(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addColumn();
              }
            }}
            placeholder="New column label"
            aria-label="New column label"
            className="h-7 w-36 text-xs"
          />
          <Button variant="secondary" size="sm" onClick={addColumn}>
            Add column
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
        <table
          className="w-full border-collapse text-left"
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        >
          <thead className="sticky top-0 z-10 bg-surface-muted">
            <tr>
              <th className="w-8 border-b border-border px-2 py-2 text-[10px] font-medium text-fg-subtle">
                #
              </th>
              {grid.columns.map((column) => (
                <th
                  key={column.key}
                  className="border-b border-border px-2 py-2 text-[10px] font-medium text-fg-subtle"
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    {column.custom ? (
                      <span className="font-mono text-[9px] text-fg-subtle">
                        {column.key}
                      </span>
                    ) : null}
                    {column.custom ? (
                      <button
                        type="button"
                        aria-label={`Remove column ${column.label}`}
                        className="text-fg-subtle hover:text-danger"
                        onClick={() =>
                          setGrid((current) =>
                            removeGridColumn(current, column.key),
                          )
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </span>
                </th>
              ))}
              <th className="w-24 border-b border-border px-2 py-2 text-[10px] font-medium text-fg-subtle">
                Row
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, rowIndex) => {
              const rowIssues = issues.get(row.id) ?? [];
              const blocking = rowIssues.filter(isBlockingIssue);
              const duplicates = rowIssues.filter((issue) => !isBlockingIssue(issue));
              const showErrors = touched.has(row.id);
              const isDuplicate = blocking.length === 0 && duplicates.length > 0;

              return (
                <tr key={row.id} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-1 text-[10px] text-fg-subtle">
                    {rowIndex + 1}
                  </td>
                  {grid.columns.map((column, columnIndex) => {
                    const issue = rowIssues.find(
                      (candidate) => candidate.field === column.key,
                    );
                    const flagged = showErrors && issue !== undefined;
                    const invalid = flagged && isBlockingIssue(issue!);
                    return (
                      <td key={column.key} className="px-1 py-1">
                        <input
                          ref={(element) => {
                            const key = cellKey(row.id, column.key);
                            if (element) inputs.current.set(key, element);
                            else inputs.current.delete(key);
                          }}
                          value={row.values[column.key] ?? ""}
                          title={flagged ? (issue?.message ?? "") : undefined}
                          aria-label={`${column.label} row ${rowIndex + 1}`}
                          aria-invalid={invalid || undefined}
                          onFocus={() =>
                            setFocus({ rowId: row.id, columnIndex })
                          }
                          onChange={(event) =>
                            setGrid((current) =>
                              updateGridCell(
                                current,
                                row.id,
                                column.key,
                                event.target.value,
                              ),
                            )
                          }
                          onBlur={() => touch(row.id)}
                          className={cn(
                            "h-7 w-full min-w-[8rem] rounded border bg-transparent px-2 text-xs text-fg outline-none",
                            "focus:border-accent focus:ring-1 focus:ring-[var(--ring)]",
                            invalid && "border-danger text-danger",
                            !invalid &&
                              isDuplicate &&
                              showErrors &&
                              "border-warning text-warning",
                            !flagged && "border-transparent hover:border-border",
                          )}
                        />
                      </td>
                    );
                  })}
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Duplicate row ${rowIndex + 1}`}
                        title="Duplicate row"
                        className="rounded p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg"
                        onClick={() =>
                          setGrid((current) =>
                            duplicateGridRow(current, row.id, makeId),
                          )
                        }
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Insert row above ${rowIndex + 1}`}
                        title="Insert row above"
                        className="rounded p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg"
                        onClick={() =>
                          setGrid((current) =>
                            insertGridRow(current, row.id, "above", makeId),
                          )
                        }
                      >
                        <ArrowUpFromLine className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Insert row below ${rowIndex + 1}`}
                        title="Insert row below"
                        className="rounded p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg"
                        onClick={() =>
                          setGrid((current) =>
                            insertGridRow(current, row.id, "below", makeId),
                          )
                        }
                      >
                        <ArrowDownToLine className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete row ${rowIndex + 1}`}
                        title="Delete row"
                        className="rounded p-1 text-fg-subtle hover:bg-surface-muted hover:text-danger"
                        onClick={() =>
                          setGrid((current) => removeGridRow(current, row.id))
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Counters and hints */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-fg-muted">
          {counts.total} row{counts.total === 1 ? "" : "s"} ·{" "}
          <span className="text-fg">{counts.ready} ready</span>
          {counts.invalid > 0 ? (
            <>
              {" · "}
              <span className="text-danger">{counts.invalid} invalid</span>
            </>
          ) : null}
          {counts.duplicate > 0 ? (
            <>
              {" · "}
              <span className="text-warning">
                {counts.duplicate} duplicate
              </span>
            </>
          ) : null}
        </span>
        <span className="text-fg-subtle">
          Tab moves · Enter next row · Cmd+Enter import · Cmd+Backspace clear
          row
        </span>
      </div>

    </div>
  );
}
