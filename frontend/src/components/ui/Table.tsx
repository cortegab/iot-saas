"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Right-aligns the column (numbers). */
  numeric?: boolean;
}

/** Simple presentational table in the DESIGN.md §6 anatomy (sentence-case
 * 40px header, `p-cell` rows, soft dividers, hover tint). Catalog lists use
 * the full `DataTable` kit (sorting, selection, cards on phones); this one is
 * for small embedded tables. */
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
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full border-collapse text-left text-sm tabular-nums">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.header}
                className={cn(
                  "h-10 whitespace-nowrap border-b border-border bg-surface px-3 text-xs font-medium text-ink-muted",
                  col.numeric && "text-right",
                  col.className,
                )}
              >
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
                "border-b border-border-soft transition-colors duration-100 last:border-b-0 hover:bg-row-hover",
                onRowClick && "cursor-pointer",
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={cn("px-3 py-cell align-middle text-ink", col.numeric && "text-right", col.className)}
                >
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
