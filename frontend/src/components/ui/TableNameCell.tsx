import type { ReactNode } from "react";
import Link from "next/link";

export interface TableNameCellProps {
  href: string;
  name: ReactNode;
  /** Muted second line — a count summary, a timestamp, an owning entity. */
  sublabel?: ReactNode;
  /** Rendered inline right after the name, inside the link (e.g. a "Legacy"
   * badge). */
  trailing?: ReactNode;
}

/** The standard first cell of a records table: a bold accent-hover link to the
 * record, with an optional muted descriptive line beneath it. Keeps every list
 * (`/devices`, `/dashboards`, `/devices/templates`, …) on the same row shape. */
export function TableNameCell({ href, name, sublabel, trailing }: TableNameCellProps) {
  return (
    <div className="flex flex-col">
      <Link href={href} className="font-medium text-ink hover:text-accent">
        {name}
        {trailing}
      </Link>
      {sublabel != null && <span className="mt-0.5 text-xs text-ink-muted">{sublabel}</span>}
    </div>
  );
}
