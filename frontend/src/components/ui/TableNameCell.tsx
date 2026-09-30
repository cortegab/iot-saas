import type { ReactNode } from "react";
import Link from "next/link";

export interface TableNameCellProps {
  href: string;
  name: ReactNode;
  /** Muted second line — a count summary, a timestamp, an owning entity. */
  sublabel?: ReactNode;
  /** Rendered inline right after the name (e.g. a "Legacy" tag). */
  trailing?: ReactNode;
}

/** The standard first cell of a records table (DESIGN.md §6): the record name
 * as a link, with an optional muted secondary line beneath it. */
export function TableNameCell({ href, name, sublabel, trailing }: TableNameCellProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-2">
        <Link
          href={href}
          className="font-medium text-ink underline-offset-[3px] hover:text-accent hover:underline"
        >
          {name}
        </Link>
        {trailing}
      </span>
      {sublabel != null && (
        <span className="block max-w-[44ch] truncate text-xs text-ink-muted">{sublabel}</span>
      )}
    </div>
  );
}
