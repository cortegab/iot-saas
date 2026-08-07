/**
 * Skeleton rows sized like the content they stand in for, so nothing shifts
 * layout when real content lands (UX_UI_Description.md's Loading state
 * requirement). `rows`/`rowClassName` let a caller match its own layout
 * (e.g. a table row height vs. a card) instead of one generic shimmer block.
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
        <div
          key={i}
          className={`animate-pulse rounded-md bg-surface-raised ${rowClassName}`}
        />
      ))}
    </div>
  );
}
