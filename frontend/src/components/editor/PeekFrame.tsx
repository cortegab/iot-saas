"use client";

import { useContext, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PeekNavContext } from "@/components/list/peek-nav";

/**
 * A record's read-only peek (DESIGN.md §7), shown in a drawer over its list
 * (ListWithPeek): looking happens here, changing happens on the record's
 * page. Eyebrow + title, a line of description, key facts, the one or two
 * next steps (Edit / Open), ‹ › to the neighbouring rows with "n of N", a ⋯
 * menu and close. No fields and no save bar.
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
  /** The next steps: an "Edit …" link and/or "Open". */
  primary?: ReactNode;
  menu?: DropdownMenuItem[][];
  onClose: () => void;
  children?: ReactNode;
}) {
  const nav = useContext(PeekNavContext);
  const shown = (facts ?? []).filter(([, v]) => v != null && v !== false && v !== "");

  return (
    <div role="region" aria-label={`${title} details`} className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex shrink-0 items-start gap-2.5 border-b border-border px-5 pb-4 pt-4">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {eyebrow && <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">{eyebrow}</div>}
          <h2 className="break-words text-[19px] font-semibold leading-[1.3] tracking-[-0.015em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
          {primary && <div className="mt-3 flex flex-wrap items-center gap-2">{primary}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {nav && nav.index >= 0 && nav.total > 1 && (
            <div className="mr-1 flex items-center">
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
        {shown.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13.5px]">
            {shown.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="m-0 min-w-0 break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </div>
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
