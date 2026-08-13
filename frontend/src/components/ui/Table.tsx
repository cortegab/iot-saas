"use client";

import type { ReactNode } from "react";

export interface TableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/** Generic list table — replaces one-off `<ul>`/`<li>` card lists where a
 * scannable, filterable row layout fits better (devices, device types).
 * Presentational only: sorting/filtering stays with the caller. */
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
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.header} className={`px-3 py-2 font-medium ${col.className ?? ""}`}>
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
              className={`border-t border-border ${
                onRowClick ? "cursor-pointer hover:bg-surface-raised" : ""
              }`}
            >
              {columns.map((col) => (
                <td key={col.header} className={`px-3 py-2 text-ink ${col.className ?? ""}`}>
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
