"use client";

import { forwardRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { IssueMarks } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";

/** A bordered group of Line rows (DESIGN.md §5). */
export function Lines({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-surface", className)}
    >
      {children}
    </div>
  );
}

export interface LineRowProps {
  /** Leading icon (lucide, size 16), drawn muted. */
  icon?: ReactNode;
  title: ReactNode;
  /** The muted second line. */
  sub?: ReactNode;
  /** Tags before the chevron ("Not wired"). */
  end?: ReactNode;
  /** Problems that block saving (a red count, and a red edge on the row). */
  issues?: number;
  /** Safety warnings (an amber "!"). */
  warn?: boolean;
  /** This row's sheet is open. */
  selected?: boolean;
  onOpen: () => void;
  className?: string;
}

/** One child item as one line: icon, bold name, muted second line, tags, its
 * problem marks and a chevron. Click or Enter opens its item sheet. */
export const LineRow = forwardRef<HTMLButtonElement, LineRowProps>(function LineRow(
  { icon, title, sub, end, issues = 0, warn = false, selected = false, onOpen, className },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-current={selected || undefined}
      aria-haspopup="dialog"
      className={cn(
        "flex min-h-12 w-full min-w-0 items-center gap-3 border-t border-border-soft px-3.5 py-2.5 text-left text-sm first:border-t-0",
        "transition-colors hover:bg-row-hover",
        selected && "bg-accent-muted",
        issues > 0 && "shadow-[inset_3px_0_0_var(--color-status-error)]",
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="shrink-0 text-ink-muted">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate font-medium text-ink">{title}</b>
        {sub && <span className="truncate text-xs text-ink-muted">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2.5 text-xs text-ink-muted">
        {end}
        <IssueMarks issues={issues} warn={warn} />
        <ChevronRight aria-hidden size={15} />
      </span>
    </button>
  );
});
