import type { ReactNode } from "react";
import Link from "next/link";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Renders "← {label}" above the title row, linking back to the resource's
   * list page. Omit on list pages themselves — there's nothing to go back to. */
  back?: { href: string; label: string };
  /** Primary action(s) for this page — a "Create X" button, a status badge,
   * a delete button, etc. Right-aligned against the title. */
  actions?: ReactNode;
}

/** Standardizes the title/back-link/action-row shape that was previously
 * reimplemented ad hoc per page under three slightly different conventions
 * (some with a back-link and no actions, some with actions and no back-link,
 * some with neither). */
export function PageHeader({ title, subtitle, back, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      {back && (
        <Link href={back.href} className="text-sm text-ink-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}
