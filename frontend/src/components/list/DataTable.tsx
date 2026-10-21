"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/cn";
import type { SortDir } from "@/components/list/useListState";

export interface DataColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  /** Right-aligned figures. */
  numeric?: boolean;
  /** Hidden on phones (the stacked card shows the essentials only). */
  hideOnPhone?: boolean;
  /** DESIGN.md §6 folding, by the table's own width: P3 columns go below
   * 860px and P2 below 720px. Their `fold` text then joins the first
   * column's second line, so nothing is lost. */
  priority?: 2 | 3;
  /** Short text for the folded value ("Taller", "4 d ago"). */
  fold?: (row: T) => ReactNode;
  className?: string;
}

const FOLD_HIDE: Record<2 | 3, string> = { 2: "@max-[720px]:hidden", 3: "@max-[860px]:hidden" };
const FOLD_SHOW: Record<2 | 3, string> = { 2: "@max-[720px]:inline", 3: "@max-[860px]:inline" };

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name for the table ("Devices"). */
  label: string;
  sort?: { key: string; dir: SortDir } | null;
  onSort?: (key: string) => void;
  /** Clicking a row (outside its buttons/links) opens the record. */
  onRowClick?: (row: T) => void;
  /** Bulk selection: renders a checkbox column. */
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void; rowLabel: (row: T) => string };
  /** ⋯ menu per row. */
  rowMenu?: (row: T) => DropdownMenuItem[][];
  rowMenuLabel?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  /** Highlights the row whose peek is open. */
  currentKey?: string | null;
  /** Enter on a focused row; defaults to `onRowClick` (a peek list opens
   * the record page when its row is already peeked). */
  onRowEnter?: (row: T) => void;
}

const INTERACTIVE = "a, button, input, select, textarea, label, [role='menuitem']";

/** DESIGN.md §6 table: sortable columns, name cell with a secondary line,
 * status pill, right-aligned numbers, row ⋯ menu, bulk-select column, hover
 * highlight, row click opens the record. Laid out by the table's own width:
 * P3 / P2 columns fold below 860 / 720px into the name's second line, and
 * from 600px down rows become stacked cards with the same fields. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  sort,
  onSort,
  onRowClick,
  selection,
  rowMenu,
  rowMenuLabel,
  rowClassName,
  currentKey,
  onRowEnter,
}: DataTableProps<T>) {
  const allSelected = selection != null && rows.length > 0 && rows.every((r) => selection.selected.has(rowKey(r)));
  const someSelected = selection != null && rows.some((r) => selection.selected.has(rowKey(r)));

  function toggleAll() {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const r of rows) {
      if (allSelected) next.delete(rowKey(r));
      else next.add(rowKey(r));
    }
    selection.onChange(next);
  }

  function toggleOne(key: string) {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  }

  function onRowActivate(e: MouseEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onRowClick(row);
  }

  function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick || e.target !== e.currentTarget) return;
    if (e.key === "Enter") (onRowEnter ?? onRowClick)(row);
  }

  // P3 folds first (at the wider width), so it leads the line.
  const folding = columns.filter((c) => c.priority && c.fold).sort((a, b) => b.priority! - a.priority!);

  return (
    <div className="@container">
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card @max-[600px]:overflow-visible">
      <table aria-label={label} className="w-full border-collapse text-sm tabular-nums @max-[600px]:block">
        <thead className="@max-[600px]:hidden">
          <tr>
            {selection && (
              <th scope="col" className="h-10 w-9 border-b border-border bg-surface pl-3">
                <input
                  type="checkbox"
                  aria-label={`Select all shown ${label.toLowerCase()}`}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleAll}
                  className="h-[15px] w-[15px] accent-[var(--color-accent)]"
                />
              </th>
            )}
            {columns.map((col) => {
              const active = sort?.key === col.id;
              const ariaSort = active ? (sort?.dir === "asc" ? "ascending" : "descending") : col.sortable ? "none" : undefined;
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    "h-10 whitespace-nowrap border-b border-border bg-surface px-3 text-left text-xs font-medium text-ink-muted",
                    col.numeric && "text-right",
                    col.className,
                    col.priority && FOLD_HIDE[col.priority],
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.id)}
                      className={cn("inline-flex items-center gap-1 hover:text-ink", col.numeric && "flex-row-reverse")}
                    >
                      {col.header}
                      {active ? (
                        sort?.dir === "asc" ? (
                          <ArrowUp aria-hidden size={12} className="text-accent" />
                        ) : (
                          <ArrowDown aria-hidden size={12} className="text-accent" />
                        )
                      ) : (
                        <ArrowUpDown aria-hidden size={12} className="opacity-55" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
            {rowMenu && (
              <th scope="col" className="h-10 w-11 border-b border-border bg-surface">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="@max-[600px]:block">
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selection?.selected.has(key) ?? false;
            return (
              <tr
                key={key}
                onClick={(e) => onRowActivate(e, row)}
                onKeyDown={(e) => onRowKey(e, row)}
                tabIndex={onRowClick ? 0 : undefined}
                data-row-key={key}
                aria-current={currentKey === key || undefined}
                className={cn(
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  "group border-b border-border-soft transition-colors duration-100 last:border-b-0 hover:bg-row-hover",
                  onRowClick && "cursor-pointer",
                  selected && "bg-accent-muted hover:bg-accent-muted",
                  currentKey === key && "bg-row-hover shadow-[inset_3px_0_0_var(--color-accent)]",
                  // Phone: a two-line card.
                  "@max-[600px]:relative @max-[600px]:flex @max-[600px]:flex-wrap @max-[600px]:items-center @max-[600px]:gap-x-3 @max-[600px]:gap-y-1.5 @max-[600px]:py-3 @max-[600px]:pl-3.5 @max-[600px]:pr-14",
                  selection && "@max-[600px]:pl-[50px]",
                  rowClassName?.(row),
                )}
              >
                {selection && (
                  <td className="w-9 pl-3 align-middle @max-[600px]:absolute @max-[600px]:left-3.5 @max-[600px]:top-[13px] @max-[600px]:w-auto @max-[600px]:p-0">
                    <input
                      type="checkbox"
                      aria-label={`Select ${selection.rowLabel(row)}`}
                      checked={selected}
                      onChange={() => toggleOne(key)}
                      className="h-[15px] w-[15px] accent-[var(--color-accent)] @max-[600px]:h-5 @max-[600px]:w-5"
                    />
                  </td>
                )}
                {columns.map((col, i) => (
                  <td
                    key={col.id}
                    className={cn(
                      "px-3 py-cell align-middle text-ink",
                      col.numeric && "text-right",
                      col.className,
                      "@max-[600px]:block @max-[600px]:p-0 @max-[600px]:text-left",
                      i === 0 && "@max-[600px]:min-w-0 @max-[600px]:basis-full",
                      col.hideOnPhone && "@max-[600px]:hidden",
                      col.priority && FOLD_HIDE[col.priority],
                    )}
                  >
                    {col.cell(row)}
                    {i === 0 && folding.length > 0 && (
                      <span className="block text-xs text-ink-muted">
                        {folding.map((c) => (
                          <span key={c.id} className={cn("hidden before:content-['·_'] first:before:content-none", FOLD_SHOW[c.priority!])}>
                            {c.fold!(row)}{" "}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                ))}
                {rowMenu && (
                  <td className="w-11 pr-1.5 text-right align-middle @max-[600px]:absolute @max-[600px]:right-1 @max-[600px]:top-1 @max-[600px]:w-auto @max-[600px]:p-0">
                    {(() => {
                      // A row with nothing to offer shows no ⋯ at all, not an empty menu.
                      const groups = rowMenu(row).filter((g) => g.length > 0);
                      return groups.length > 0 ? (
                        <DropdownMenu
                          groups={groups}
                          label={rowMenuLabel?.(row) ?? "Actions"}
                          triggerClassName="inline-grid h-[30px] w-[30px] place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink @max-[600px]:h-[42px] @max-[600px]:w-[42px]"
                        />
                      ) : null;
                    })()}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}

/** The standard name cell: record name + muted secondary line. Pass an
 * `href` to make the name a link (row click still opens it too). */
export function NameCell({
  name,
  sub,
  trailing,
  mono,
}: {
  name: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "truncate font-medium text-ink group-hover:text-accent",
            mono && "font-mono text-[13.5px]",
          )}
        >
          {name}
        </span>
        {trailing}
      </span>
      {sub != null && <span className="block max-w-[44ch] truncate text-xs text-ink-muted">{sub}</span>}
    </div>
  );
}
