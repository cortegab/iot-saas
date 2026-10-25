"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { DEFAULT_RANGE_MS } from "@/lib/chart-range";
import { timeAgo } from "@/lib/time-ago";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];

/** The dashboard's one time range (demo H header): every trend widget follows it. */
export const DashboardRange = createContext<number>(DEFAULT_RANGE_MS);
export const useDashboardRange = () => useContext(DashboardRange);

/** The device a widget reads, linking to its page. */
export function DeviceLink({ device }: { device?: DeviceResponse }) {
  if (!device) return null;
  return (
    <Link href={`/devices/${device.id}`} className="hover:text-accent hover:underline">
      {device.name}
    </Link>
  );
}

/** The device and its template's definition of `metric` (name, unit,
 * decimals) — both SWR keys are shared with the rest of the app. */
export function useWidgetDevice(deviceId: string, metric?: string | null) {
  const { data: device, isLoading } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`, { refreshInterval: 20_000 });
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const meta: CatalogMetric | undefined = metric ? template?.metrics.find((m) => wireId(m) === metric) : undefined;
  return { device, isLoading, meta, stale: device != null && device.connection_state !== "online" };
}

/** When the value arrived; "Stale · last value, X ago" in the warning tone
 * once the device is offline (demo H) — a dashboard never shows a stale
 * number as current. */
export function WidgetFoot({ stale, time }: { stale: boolean; time?: string | null }) {
  return stale ? (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-status-pending">
      <AlertTriangle aria-hidden size={12} />
      Stale · last value{time ? ` ${timeAgo(time)}` : ""}
    </span>
  ) : (
    <span className="text-[11.5px] text-ink-muted">{time ? timeAgo(time) : "live"}</span>
  );
}
