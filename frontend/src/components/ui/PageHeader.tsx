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
  /** Small line above the title (record kind, e.g. "Device"). */
  eyebrow?: ReactNode;
  /** Status pill beside the eyebrow. */
  status?: ReactNode;
  /** Facts row under the description (zone, template, last seen…). */
  meta?: ReactNode;
  /** A path trail above the title (e.g. Devices › bay1-climate). */
  breadcrumbs?: Crumb[];
  /** @deprecated — rendered as a one-level breadcrumb. */
  back?: { href: string; label: string };
  /** Page actions; the primary action goes last (rightmost). */
  actions?: ReactNode;
  /** Render the title in the mono face (device names). */
  monoTitle?: boolean;
}

/** A breadcrumb trail on its own (for pages whose H1 lives elsewhere, e.g. a
 * full-page editor). */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-muted">
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

/** DESIGN.md §4 page header: breadcrumbs, an overline and status pill where
 * relevant, an H1, a one-line description, a meta row, and actions on the
 * right. */
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
  monoTitle,
}: PageHeaderProps) {
  const crumbs = breadcrumbs ?? (back ? [{ label: back.label, href: back.href }] : undefined);
  const desc = description ?? subtitle;
  return (
    <header className="flex flex-col gap-2">
      {crumbs && crumbs.length > 0 && <Breadcrumbs crumbs={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {(eyebrow || status) && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              {eyebrow}
              {status}
            </div>
          )}
          <h1
            className={`flex flex-wrap items-center gap-3 text-[24px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink md:text-[30px] ${
              monoTitle ? "font-mono font-medium tracking-[-0.01em]" : ""
            }`}
          >
            {title}
          </h1>
          {desc && <p className="mt-1.5 max-w-[64ch] text-ink-muted">{desc}</p>}
          {meta && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-ink-muted [&_b]:font-medium [&_b]:text-ink">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
