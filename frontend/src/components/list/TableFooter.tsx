"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PAGE_SIZES } from "@/components/list/useListState";
import { pageItems } from "@/components/list/usePager";
import { cn } from "@/lib/cn";

/** DESIGN.md §6 table footer: result count ("12 of 15 devices"), page size
 * and a numbered pager (‹ 1 2 [3] … 9 ›; ‹ 3 / 9 › on phones). The pager
 * hides while everything fits on one page. */
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
          <nav aria-label="Pagination" className="flex items-center gap-0.5">
            <IconButton aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              <ChevronLeft aria-hidden size={15} />
            </IconButton>
            <span className="px-1.5 tabular-nums sm:hidden">
              {page} / {pageCount}
            </span>
            {pageItems(page, pageCount).map((item, i) =>
              item === "…" ? (
                <span key={`gap-${i}`} aria-hidden className="w-6 text-center max-sm:hidden">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  aria-label={`Page ${item}`}
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => onPage(item)}
                  className={cn(
                    "h-[30px] min-w-[30px] rounded-md px-1.5 tabular-nums transition-colors duration-150 max-sm:hidden",
                    item === page ? "bg-accent-muted font-semibold text-accent-strong" : "hover:bg-surface-raised hover:text-ink",
                  )}
                >
                  {item}
                </button>
              ),
            )}
            <IconButton aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
              <ChevronRight aria-hidden size={15} />
            </IconButton>
          </nav>
        </div>
      )}
    </div>
  );
}
