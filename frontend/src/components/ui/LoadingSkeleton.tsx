import { cn } from "@/lib/cn";

/**
 * Skeleton blocks sized like the content they stand in for, so nothing shifts
 * when real content lands (DESIGN.md §5). `rows`/`rowClassName` let a caller
 * match its own layout. For list pages use `TableSkeleton`.
 */
export function LoadingSkeleton({
  rows = 3,
  rowClassName = "h-12",
}: {
  rows?: number;
  rowClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn("animate-pulse rounded-md bg-surface-raised", rowClassName)} />
      ))}
    </div>
  );
}

/** Skeleton rows in a table frame — the loading state of every catalog list. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-5 border-b border-border-soft px-4 py-3.5 last:border-b-0"
          style={{ gridTemplateColumns: `2fr repeat(${Math.max(columns - 1, 1)}, 1fr)` }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <span key={c} className="h-2.5 animate-pulse rounded bg-surface-raised" />
          ))}
        </div>
      ))}
    </div>
  );
}
