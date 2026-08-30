"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/** Generic list table — replaces one-off `<ul>`/`<li>` card lists where a
 * scannable, filterable row layout fits better (devices, device types).
 * Presentational only: sorting/filtering stays with the caller.
 *
 * Reads as a panel: a `bg-surface` card with a tinted header strip and a
 * divider between every row, so it sits on the page rather than dissolving
 * into the canvas. Rows tint on hover whether or not they're clickable —
 * every list's first cell is a link, so it's a scannability aid either way. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border border-t-panel-edge bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-raised font-mono text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.header} className={`px-3 py-2.5 font-medium ${col.className ?? ""}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-t border-border transition-colors duration-100 first:border-t-0 hover:bg-accent-muted",
                onRowClick && "cursor-pointer",
              )}
            >
              {columns.map((col) => (
                <td key={col.header} className={`px-3 py-2.5 text-ink ${col.className ?? ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
