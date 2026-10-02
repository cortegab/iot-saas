"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Link2, Pencil, Power, SquareArrowOutUpRight, Trash2, Zap } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { buttonClassName } from "@/components/ui/Button";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekPlaceholder, PeekSection, type PeekMode } from "@/components/editor/PeekFrame";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A device at a glance: status, where it is, what it reports right now.
 * Its readings, controls and settings live on /devices/{id}. */
export function DevicePeek({
  device,
  template,
  zoneName,
  ruleCount,
  mode,
  onClose,
  onRotate,
  onToggle,
  onDelete,
}: {
  device: DeviceResponse | undefined;
  template: CatalogEntryResponse | undefined;
  zoneName: string | undefined;
  ruleCount: number;
  mode: PeekMode;
  onClose: () => void;
  onRotate: (d: DeviceResponse) => void;
  onToggle: (d: DeviceResponse) => void;
  onDelete: (d: DeviceResponse) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("devices.write");
  const { data: latest } = useApiSWR<TelemetryLatestResponse[]>(device ? `/devices/${device.id}/latest` : null);
  if (!device) return <PeekPlaceholder mode={mode} noun="device" missing onClose={onClose} />;

  const metricMeta = new Map((template?.metrics ?? []).map((m) => [m.key ?? m.name, m]));
  const stale = device.connection_state !== "online";
  const menu: DropdownMenuItem[][] = [
    [
      {
        label: "Copy link",
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/devices/${device.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
      },
    ],
    ...(canWrite
      ? [
          [
            { label: "Connect and get firmware", icon: <Zap size={15} />, onClick: () => router.push(`/devices/${device.id}/connect`) },
            { label: "Rotate credential…", icon: <KeyRound size={15} />, onClick: () => onRotate(device) },
            { label: device.status === "active" ? "Disable" : "Enable", icon: <Power size={15} />, onClick: () => onToggle(device) },
          ],
          [{ label: "Delete device…", icon: <Trash2 size={15} />, danger: true, onClick: () => onDelete(device) }],
        ]
      : []),
  ];

  return (
    <PeekFrame
      mode={mode}
      noun="device"
      title={device.name}
      eyebrow={
        <>
          Device <DeviceStatusPill device={device} />
        </>
      }
      facts={[
        ["Template", template ? <Link href={`/templates?peek=${template.id}`} className="text-accent hover:underline">{template.name}</Link> : null],
        ["Zone", zoneName ?? "No zone"],
        ["Last seen", device.last_seen_at ? timeAgo(device.last_seen_at) : "Never"],
        ["Rules", ruleCount ? plural(ruleCount, "rule") : "None"],
        ["Firmware", device.fw_version],
        ["Signal", device.rssi != null ? `${device.rssi} dBm` : null],
      ]}
      primary={
        <>
          <Link href={`/devices/${device.id}`} className={buttonClassName({ size: "sm" })}>
            <SquareArrowOutUpRight aria-hidden size={14} /> Open device
          </Link>
          {canWrite && (
            <Link href={`/devices/${device.id}?tab=settings`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
              <Pencil aria-hidden size={14} /> Edit settings
            </Link>
          )}
        </>
      }
      menu={menu}
      onClose={onClose}
    >
      <PeekSection title={stale ? "Last readings" : "Latest readings"}>
        {!latest ? (
          <LoadingSkeleton rows={2} rowClassName="h-6" />
        ) : latest.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No readings yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-soft rounded-lg border border-border">
            {latest.map((r) => {
              const meta = metricMeta.get(r.metric);
              const value = meta?.data_type === "bool" ? (r.value ? "On" : "Off") : meta?.decimals != null ? r.value.toFixed(meta.decimals) : String(r.value);
              return (
                <li key={r.metric} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13.5px]">
                  <span className="truncate text-ink-muted">{meta?.name ?? r.metric}</span>
                  <span className="flex items-baseline gap-2 whitespace-nowrap">
                    <b className={stale ? "font-medium text-ink-muted" : "font-medium text-ink"}>
                      {value}
                      {meta?.unit && meta.data_type !== "bool" && <span className="ml-0.5 text-[12px] font-normal text-ink-muted">{meta.unit}</span>}
                    </b>
                    <span className="text-[12px] text-ink-muted">{timeAgo(r.time)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PeekSection>
    </PeekFrame>
  );
}
