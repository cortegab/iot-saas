import type { ReactNode } from "react";
import type { components } from "@/types/api";
import { DeviceLink } from "@/components/dashboards/widget-common";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** Common chrome for every widget type: one bold title, *Reading · Device*
 * (demo H; the device links to its page), and a clipped body. Editing tools
 * (move, size, remove) are drawn by DashboardGrid over the top-right corner,
 * only in edit-layout mode. */
export function WidgetCard({
  title,
  device,
  children,
}: {
  /** What it shows ("Temperature"); left out, the device's name is the title. */
  title?: string;
  device?: DeviceResponse;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="widget-title flex shrink-0 items-baseline px-3.5 pb-1 pt-3">
        <b className="truncate text-[13.5px] font-semibold text-ink">
          {title}
          {title && device && " · "}
          <DeviceLink device={device} />
        </b>
      </div>
      {/* Clipped, not scrollable — widgets are resizable, so "see more" means
          drag it bigger, not scroll inside a small box (which also fights
          with react-grid-layout's own drag/resize gestures). */}
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 pb-3.5 pt-1">{children}</div>
    </div>
  );
}
