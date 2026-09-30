"use client";

import type { ReactNode } from "react";
import { Badge, type DotShape, type StatusTone } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

export interface KpiItem {
  id: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: StatusTone;
  shape?: DotShape;
}

const TONE_BORDER: Record<StatusTone, string> = {
  online: "shadow-[inset_0_-2px_0_var(--color-status-online)] bg-status-online/7",
  offline: "shadow-[inset_0_-2px_0_var(--color-status-offline)] bg-status-offline/7",
  pending: "shadow-[inset_0_-2px_0_var(--color-status-pending)] bg-status-pending/7",
  unknown: "shadow-[inset_0_-2px_0_var(--color-status-unknown)] bg-status-unknown/7",
  error: "shadow-[inset_0_-2px_0_var(--color-status-error)] bg-status-error/7",
  accent: "shadow-[inset_0_-2px_0_var(--color-accent)] bg-accent/7",
};

/** DESIGN.md §5 KPI strip: 3–4 figures in one bordered strip above a list,
 * only where the counts drive action. With `onSelect`, each figure is a
 * filter toggle (`active` highlights the current one). */
export function KpiStrip({
  items,
  active,
  onSelect,
  ariaLabel = "Summary",
}: {
  items: KpiItem[];
  active?: string | null;
  onSelect?: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role={onSelect ? "group" : undefined}
      aria-label={ariaLabel}
      className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface shadow-card md:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
      style={{ ["--n" as string]: items.length }}
    >
      {items.map((item, i) => {
        const isActive = active === item.id;
        const body = (
          <>
            <span className="flex items-center gap-[7px] text-xs text-ink-muted">
              {item.tone && <Badge tone={item.tone} shape={item.shape} label={item.label} variant="indicator" />}
              {item.label}
            </span>
            <span className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] tabular-nums text-ink">
              {item.value}
            </span>
            {item.sub && <span className="text-xs text-ink-muted">{item.sub}</span>}
          </>
        );
        const cls = cn(
          "flex min-w-0 flex-col gap-0.5 border-border px-[18px] py-4 text-left",
          // Hairlines between cells: left border except the first in each row,
          // top border for the second row on the 2-column phone layout.
          i % 2 === 1 && "border-l",
          i >= 2 && "border-t md:border-t-0",
          "md:border-l md:first:border-l-0",
          isActive && item.tone && TONE_BORDER[item.tone],
        );
        return onSelect ? (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(item.id)}
            className={cn(cls, "transition-colors duration-150 hover:bg-row-hover")}
          >
            {body}
          </button>
        ) : (
          <div key={item.id} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
