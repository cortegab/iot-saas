import type { ReactNode } from "react";
import Link from "next/link";

export interface Crumb {
  label: ReactNode;
  /** Omit for the current page (the last crumb) — it renders as plain text. */
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Renders "← {label}" above the title row, linking back to the resource's
   * list page. Omit on list pages themselves — there's nothing to go back to.
   * Ignored when `breadcrumbs` is set. */
  back?: { href: string; label: string };
  /** A path trail above the title (e.g. Devices / ESP32-T1). Takes precedence
   * over `back`. */
  breadcrumbs?: Crumb[];
  /** Primary action(s) for this page — a "Create X" button, a status badge,
   * a delete button, etc. Right-aligned against the title. */
  actions?: ReactNode;
}

/** Standardizes the trail/title/action-row shape used across pages. */
export function PageHeader({ title, subtitle, back, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="opacity-50">
                  /
                </span>
              )}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-ink">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-ink">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : (
        back && (
          <Link href={back.href} className="text-sm text-ink-muted hover:text-ink">
            ← {back.label}
          </Link>
        )
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}
