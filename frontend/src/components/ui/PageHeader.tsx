import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: ReactNode;
  /** Omit for the current page (the last crumb) — it renders as plain text. */
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  /** One-line description under the title. */
  description?: ReactNode;
  /** @deprecated use `description`. */
  subtitle?: ReactNode;
  /** The overline after the status: meta, never the record kind. */
  eyebrow?: ReactNode;
  /** The record's status, first in the overline (DESIGN.md §4). */
  status?: ReactNode;
  /** Facts row under the description (zone, template, last seen…). */
  meta?: ReactNode;
  /** A path trail above the title (e.g. Devices › bay1-climate). */
  breadcrumbs?: Crumb[];
  /** @deprecated — rendered as a one-level breadcrumb. */
  back?: { href: string; label: string };
  /** Page actions; the primary action goes last (rightmost). */
  actions?: ReactNode;
  /** List pages (DESIGN.md §6): the description sits beside the title, on
   * its baseline, and wraps under it when there's no room. */
  inline?: boolean;
}

/** A breadcrumb trail on its own (for pages whose H1 lives elsewhere, e.g. a
 * full-page editor). */
/** Parents only (DESIGN.md §4): the H1 right below names the current page, so
 * a trailing crumb without a link isn't shown. */
export function Breadcrumbs({ crumbs: all }: { crumbs: Crumb[] }) {
  const crumbs = all.filter((c) => c.href);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-meta text-ink-muted">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight aria-hidden size={13} className="opacity-60" />}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-accent">
              {crumb.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-ink">
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** The one header anatomy (DESIGN.md §4), shared by PageHeader and the
 * full-page editors: the overline (status first, then meta), then the title
 * row with the actions on its right, top-aligned with the title (primary
 * rightmost, ⋯ last), then whatever goes under the title. On phones the
 * actions are one row directly under the title. */
export function HeaderBlock({
  overline,
  heading,
  actions,
  children,
}: {
  overline?: ReactNode;
  /** The title element itself (an `h1`, or the title and description inline). */
  heading: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      {overline && <div className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">{overline}</div>}
      <div className="flex items-start justify-between gap-x-4 gap-y-2.5 max-md:flex-col max-md:items-stretch">
        <div className="min-w-0 flex-1">{heading}</div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** DESIGN.md §4 page header: breadcrumbs, then the HeaderBlock — overline
 * (status first, then meta), the H1 with the actions on its row, a one-line
 * description and a meta row. */
export function PageHeader({
  title,
  description,
  subtitle,
  eyebrow,
  status,
  meta,
  breadcrumbs,
  back,
  actions,
  inline,
}: PageHeaderProps) {
  const crumbs = breadcrumbs ?? (back ? [{ label: back.label, href: back.href }] : undefined);
  const desc = description ?? subtitle;
  const h1 = (
    <h1 className="flex flex-wrap items-center gap-3 text-title font-semibold leading-[1.2] tracking-[-0.015em] text-ink">{title}</h1>
  );
  return (
    <header className="flex flex-col gap-2">
      {crumbs && crumbs.length > 0 && <Breadcrumbs crumbs={crumbs} />}
      <HeaderBlock
        overline={(status || eyebrow) && <>{status}{eyebrow}</>}
        heading={
          inline ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
              {h1}
              {desc && <p className="max-w-[64ch] text-ink-muted">{desc}</p>}
            </div>
          ) : (
            h1
          )
        }
        actions={actions}
      >
        {desc && !inline && <p className="mt-1 max-w-[64ch] text-ink-muted">{desc}</p>}
        {meta && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted [&_b]:font-medium [&_b]:text-ink">
            {meta}
          </div>
        )}
      </HeaderBlock>
    </header>
  );
}
