import type { ReactNode } from "react";

/** Common chrome for every widget type: a title strip and a clipped body.
 * Editing tools (move, width, remove) are drawn by DashboardGrid over the
 * top-right corner, only in edit-layout mode. */
export function WidgetCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  /** Usually the device, as a link. */
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="widget-title flex shrink-0 items-baseline gap-2 px-3.5 pb-1 pt-3">
        <span className="truncate text-[13px] font-medium text-ink">{title}</span>
        {subtitle && <span className="truncate text-xs text-ink-muted">{subtitle}</span>}
      </div>
      {/* Clipped, not scrollable — widgets are resizable, so "see more" means
          drag it bigger, not scroll inside a small box (which also fights
          with react-grid-layout's own drag/resize gestures). */}
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 pb-3.5 pt-1">{children}</div>
    </div>
  );
}
