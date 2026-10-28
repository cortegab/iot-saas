"use client";

import { useContext, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SquareArrowOutUpRight, X } from "lucide-react";
import { buttonClassName, IconButton } from "@/components/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { FactList } from "@/components/ui/FactList";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PeekNavContext } from "@/components/list/peek-nav";

/**
 * A record's read-only peek (DESIGN.md §7), shown in a drawer over its list
 * (ListWithPeek): looking happens here, changing happens on the record's
 * page. Eyebrow (status and meta, never the record kind) + title, a line of
 * description, key facts, the next step (always "Open {noun}"), ‹ › to the
 * neighbouring rows with "n of N", a ⋯ menu and close. No fields and no save
 * bar. In a narrow drawer (phones) the controls take their own row above the
 * title, so the title keeps the full width.
 */
export function PeekFrame({
  noun,
  title,
  eyebrow,
  description,
  facts,
  primary,
  menu,
  onClose,
  children,
}: {
  /** Record kind in words ("zone", "device template"). */
  noun: string;
  title: string;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Label → value pairs, shown as a definition list. Empty values are skipped. */
  facts?: [string, ReactNode][];
  /** The next step: `<PeekOpen>` ("Open device"), plus at most one secondary. */
  primary?: ReactNode;
  menu?: DropdownMenuItem[][];
  onClose: () => void;
  children?: ReactNode;
}) {
  const nav = useContext(PeekNavContext);
  const shown = (facts ?? []).filter(([, v]) => v != null && v !== false && v !== "");

  return (
    <div role="region" aria-label={`${title} details`} className="@container flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex shrink-0 flex-col-reverse gap-2 border-b border-border px-5 pb-4 pt-3 @[30rem]:flex-row @[30rem]:items-start @[30rem]:gap-2.5 @[30rem]:pt-4">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {eyebrow && <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">{eyebrow}</div>}
          <h2 className="break-words text-[19px] font-semibold leading-[1.3] tracking-[-0.015em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
          {primary && <div className="mt-3 flex flex-wrap items-center gap-2">{primary}</div>}
        </div>
        <div className="-mx-1.5 flex shrink-0 items-center justify-end gap-0.5 @[30rem]:mx-0">
          {nav && nav.index >= 0 && nav.total > 1 && (
            <div className="mr-auto flex items-center @[30rem]:mr-1">
              <IconButton aria-label={`Previous ${noun}`} disabled={!nav.prev} onClick={() => nav.prev?.()}>
                <ChevronLeft size={17} />
              </IconButton>
              <span aria-live="polite" className="min-w-[44px] text-center text-[12.5px] tabular-nums text-ink-muted">
                {nav.index + 1} of {nav.total}
              </span>
              <IconButton aria-label={`Next ${noun}`} disabled={!nav.next} onClick={() => nav.next?.()}>
                <ChevronRight size={17} />
              </IconButton>
            </div>
          )}
          {menu && menu.length > 0 && <DropdownMenu groups={menu} label="More actions" />}
          <IconButton aria-label={`Close ${noun}`} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 pb-6 pt-4">
        <FactList facts={shown} />
        {children}
      </div>
    </div>
  );
}

/** The peek's next step: "Open {noun}" to the record's page (DESIGN.md §7). */
export function PeekOpen({ href, noun }: { href: string; noun: string }) {
  return (
    <Link href={href} className={buttonClassName({ size: "sm" })}>
      <SquareArrowOutUpRight aria-hidden size={14} /> Open {noun}
    </Link>
  );
}

/** A titled block inside a peek ("Latest readings", "Used by"). */
export function PeekSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.05em] text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

/** While the record loads, or when it no longer exists. */
export function PeekPlaceholder({ noun, missing, onClose }: { noun: string; missing?: boolean; onClose: () => void }) {
  return (
    <PeekFrame noun={noun} title={missing ? `This ${noun} doesn't exist` : "Loading…"} onClose={onClose} description={missing ? "It may have been deleted." : undefined}>
      {!missing && <LoadingSkeleton rows={3} rowClassName="h-6" />}
    </PeekFrame>
  );
}
