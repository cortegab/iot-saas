"use client";

import Link from "next/link";
import { SquareArrowOutUpRight } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { buttonClassName } from "@/components/ui/Button";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PeekFrame, PeekPlaceholder, PeekSection } from "@/components/editor/PeekFrame";
import { cn } from "@/lib/cn";
import { formatReading, isBoolMetric } from "@/lib/format-reading";
import { timeAgo } from "@/lib/time-ago";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A device at a glance (demo H peek): status and last message, where it is,
 * what it reports right now as Line rows, then Open device. Its readings,
 * controls and settings live on /devices/{id}. */
export function DevicePeek({
  device,
  template,
  zoneName,
  ruleCount,
  onClose,
  menu,
}: {
  device: DeviceResponse | undefined;
  template: CatalogEntryResponse | undefined;
  zoneName: string | undefined;
  ruleCount: number;
  onClose: () => void;
  /** The record's ⋯ menu (useDeviceActions, `where: "peek"`). */
  menu: (d: DeviceResponse) => DropdownMenuItem[][];
}) {
  const { data: latest } = useApiSWR<TelemetryLatestResponse[]>(device ? `/devices/${device.id}/latest` : null);
  if (!device) return <PeekPlaceholder noun="device" missing onClose={onClose} />;

  const stale = device.connection_state !== "online";
  const byMetric = new Map((latest ?? []).map((r) => [r.metric, r]));
  // Every declared metric, then anything undeclared it still publishes.
  const rows: { id: string; meta: CatalogMetric | undefined }[] = [
    ...(template?.metrics ?? []).map((m) => ({ id: wireId(m), meta: m })),
    ...(latest ?? []).filter((r) => !(template?.metrics ?? []).some((m) => wireId(m) === r.metric)).map((r) => ({ id: r.metric, meta: undefined })),
  ];

  return (
    <PeekFrame
      noun="device"
      title={device.name}
      eyebrow={
        <>
          Device <DeviceStatusPill device={device} />
        </>
      }
      description={`Last message ${device.last_seen_at ? timeAgo(device.last_seen_at) : "never"}`}
      facts={[
        [
          "Template",
          template ? (
            <>
              <Link href={`/templates?peek=${template.id}`} className="text-accent hover:underline">
                {template.name}
              </Link>
              {device.hardware ? " · Own wiring" : ""}
            </>
          ) : null,
        ],
        ["Zone", zoneName ?? "No zone"],
        ["Rules", ruleCount ? plural(ruleCount, "rule") : "None"],
        ["Firmware", device.fw_version],
        ["Signal", device.rssi != null ? `${device.rssi} dBm` : null],
        ["Battery", device.battery_pct != null ? `${device.battery_pct} %` : null],
      ]}
      primary={
        <Link href={`/devices/${device.id}`} className={buttonClassName({ size: "sm" })}>
          <SquareArrowOutUpRight aria-hidden size={14} /> Open device
        </Link>
      }
      menu={menu(device)}
      onClose={onClose}
    >
      {rows.length > 0 && (
        <PeekSection title={stale ? "Last readings" : "Latest readings"}>
          {!latest ? (
            <LoadingSkeleton rows={2} rowClassName="h-6" />
          ) : (
            <ul aria-label="Readings" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
              {rows.map(({ id, meta }) => {
                const r = byMetric.get(id);
                return (
                  <li key={id} className="flex min-h-11 items-center justify-between gap-3 border-t border-border-soft px-3.5 py-2 text-sm first:border-t-0">
                    <b className="truncate font-medium text-ink">{meta?.name ?? id}</b>
                    {r ? (
                      <span className={cn("whitespace-nowrap tabular-nums", stale ? "text-ink-muted" : "text-ink")} title={timeAgo(r.time)}>
                        {formatReading(r.value, meta)}
                        {meta?.unit && !isBoolMetric(meta) && <span className="ml-1 text-[12.5px] text-ink-muted">{meta.unit}</span>}
                      </span>
                    ) : (
                      <span className="text-ink-muted">No data</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PeekSection>
      )}
    </PeekFrame>
  );
}
