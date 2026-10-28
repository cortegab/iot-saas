import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

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
  /** Render the title in the mono face (device names). */
  monoTitle?: boolean;
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

/** DESIGN.md §4 page header: breadcrumbs, an overline (status first, then
 * meta), an H1, a one-line description, a meta row, and actions on the
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
  inline,
}: PageHeaderProps) {
  const crumbs = breadcrumbs ?? (back ? [{ label: back.label, href: back.href }] : undefined);
  const desc = description ?? subtitle;
  return (
    <header className="flex flex-col gap-2">
      {crumbs && crumbs.length > 0 && <Breadcrumbs crumbs={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className={inline ? "flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1" : "min-w-0"}>
          {(eyebrow || status) && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              {status}
              {eyebrow}
            </div>
          )}
          <h1
            className={`flex flex-wrap items-center gap-3 text-[24px] font-semibold leading-[1.2] tracking-[-0.015em] text-ink md:text-[28px] ${
              monoTitle ? "font-mono font-medium tracking-[-0.01em]" : ""
            }`}
          >
            {title}
          </h1>
          {desc && <p className={cn("max-w-[64ch] text-ink-muted", !inline && "mt-1.5")}>{desc}</p>}
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
