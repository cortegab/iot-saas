import type { ReactNode } from "react";

/** Common chrome for every widget type — one place for the remove affordance
 * and device label rather than repeating it in all four widget components.
 * `dragHandle` marks the strip react-grid-layout should treat as the drag
 * handle (see DashboardGrid's `draggableHandle`), so dragging doesn't fight
 * with clicking controls inside the widget body (e.g. an actuator toggle).
 */
export function WidgetCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  /** Omitted (rather than a no-op) for viewer roles — see DashboardGrid's
   * `isAdmin` prop — so the remove affordance doesn't render at all instead
   * of rendering disabled or silently doing nothing. */
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="widget-drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-border px-3 py-1.5">
        <span className="truncate text-xs font-medium text-ink-muted">{title}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove widget"
            className="text-ink-muted hover:text-status-error"
          >
            ×
          </button>
        )}
      </div>
      {/* Clipped, not scrollable — widgets are resizable, so "see more" means
          drag it bigger, not scroll inside a small box (which also fights
          with react-grid-layout's own drag/resize gestures). */}
      <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
    </div>
  );
}
