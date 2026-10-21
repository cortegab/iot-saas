"use client";

import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { WIDGET_LABEL } from "@/components/dashboards/DashboardGrid";
import { widgetTitle } from "@/components/dashboards/WidgetSheet";
import type { components } from "@/types/api";

type Widget = components["schemas"]["Widget"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** Reading order: top to bottom, then left to right. */
export const readingOrder = (widgets: Widget[]) => [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);

/** Moves a widget one place in reading order by swapping its grid place with
 * its neighbour's, so the desktop layout keeps everything else (DESIGN.md §8). */
export function moveWidget(widgets: Widget[], id: string, dir: -1 | 1): Widget[] {
  const order = readingOrder(widgets);
  const i = order.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return widgets;
  const a = order[i];
  const b = order[j];
  return widgets.map((w) => (w.id === a.id ? { ...w, x: b.x, y: b.y } : w.id === b.id ? { ...w, x: a.x, y: a.y } : w));
}

/** Edit layout on a phone (DESIGN.md §8): the widgets as a list, in reading
 * order, to open, move up or move down. The grid can't be dragged there. */
export function WidgetList({
  widgets,
  devices,
  templates,
  onOpen,
  onMove,
}: {
  widgets: Widget[];
  devices: DeviceResponse[];
  templates: CatalogEntryResponse[];
  onOpen: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const order = readingOrder(widgets);
  const src = { devices, templates };
  const iconButton =
    "grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-35";
  return (
    <ol aria-label="Widgets" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {order.map((w, i) => {
        const title = widgetTitle(w, src);
        return (
          <li key={w.id} className="flex items-center gap-1 border-t border-border-soft py-1 pl-3.5 pr-1 first:border-t-0">
            <button type="button" onClick={() => onOpen(w.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-sm font-medium text-ink">{title}</b>
                <span className="truncate text-[12.5px] text-ink-muted">{WIDGET_LABEL[w.type]}</span>
              </span>
              <ChevronRight aria-hidden size={15} className="shrink-0 text-ink-muted" />
            </button>
            <button type="button" aria-label={`Move ${title} up`} disabled={i === 0} onClick={() => onMove(w.id, -1)} className={iconButton}>
              <ArrowUp aria-hidden size={16} />
            </button>
            <button type="button" aria-label={`Move ${title} down`} disabled={i === order.length - 1} onClick={() => onMove(w.id, 1)} className={iconButton}>
              <ArrowDown aria-hidden size={16} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
