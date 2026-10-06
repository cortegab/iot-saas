"use client";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PAGE_SIZES } from "@/components/list/useListState";

/** DESIGN.md §6 table footer: result count ("12 of 15 devices"), pager and
 * page size. The pager hides while everything fits on one page. */
export function TableFooter({
  shown,
  total,
  noun,
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
}: {
  shown: number;
  total: number;
  /** [singular, plural], e.g. ["device", "devices"]. */
  noun: [string, string];
  page: number;
  pageCount: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-0.5 pt-1 text-xs text-ink-muted">
      <span aria-live="polite">
        {shown === total ? `${total} ${noun[total === 1 ? 0 : 1]}` : `${shown} of ${total} ${noun[1]}`}
      </span>
      {(pageCount > 1 || shown > PAGE_SIZES[0]) && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            Rows
            <Select
              compact
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="w-[76px]"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pageCount}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
