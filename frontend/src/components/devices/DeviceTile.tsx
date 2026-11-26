"use client";

import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import { Tag } from "@/components/ui/Badge";
import { formatReading } from "@/lib/format-reading";
import { timeAgo } from "@/lib/time-ago";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

/**
 * A device as a tile (DESIGN.md §8 *Device tiles*, §15a; ease-of-use C3): its
 * name and state, its main reading (live: the realtime layer updates the same
 * `/devices/{id}/latest` key the device page uses) and its first on/off output
 * with the same control as the device page. Stale is never shown as current.
 */
export function DeviceTile({ device, template }: { device: DeviceResponse; template?: CatalogEntryResponse }) {
  const metrics = template?.metrics ?? [];
  const main = metrics.find((m) => m.data_type !== "bool") ?? metrics[0];
  const output = (template?.actuators ?? []).find((a) => (a.value_type ?? "bool") === "bool");
  const { data: latest } = useApiSWR<TelemetryLatestResponse[]>(main ? `/devices/${device.id}/latest` : null);
  const reading = main ? latest?.find((l) => l.metric === wireId(main)) : undefined;
  const online = device.connection_state === "online";
  const disabled = device.status !== "active";

  return (
    <article aria-label={device.name} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/devices/${device.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink hover:text-accent">
          {device.name}
        </Link>
        {device.simulated && <Tag size="sm">{t("devices.simulated")}</Tag>}
        <DeviceStatusPill device={device} />
      </div>
      {main && (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-muted">{main.name}</span>
          <span className={`flex items-baseline gap-1 text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums ${reading && !online ? "opacity-55" : ""}`}>
            {reading ? formatReading(reading.value, main) : "—"}
            {reading && main.unit && main.data_type !== "bool" && <span className="text-sm font-normal tracking-normal text-ink-muted">{main.unit}</span>}
          </span>
          <span className={`text-xs ${reading && !online ? "text-status-pending" : "text-ink-muted"}`}>
            {!reading ? t("devices.nothingYet") : online ? timeAgo(reading.time) : t("devices.lastValue", { ago: timeAgo(reading.time) })}
          </span>
        </div>
      )}
      {output && (
        <ActuatorControl
          deviceId={device.id}
          deviceOnline={online}
          deviceDisabled={disabled}
          catalogEntryId={device.catalog_entry_id}
          wiring={device.hardware}
          only={wireId(output)}
        />
      )}
    </article>
  );
}
