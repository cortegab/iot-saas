"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cpu, Link2, Pencil, Trash2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekPlaceholder, type PeekMode } from "@/components/editor/PeekFrame";
import { useDeleteZone } from "./useDeleteZone";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A zone at a glance beside the list; editing happens on /zones/{id}. */
export function ZonePeek({ zone, offline, mode, onClose }: { zone: ZoneResponse | undefined; offline: number; mode: PeekMode; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("zones.write");
  const { remove, dialog } = useDeleteZone(onClose);

  if (!zone) return <PeekPlaceholder mode={mode} noun="zone" missing onClose={onClose} />;

  const status =
    zone.device_count === 0 ? (
      <Badge tone="unknown" shape="square" label="No devices" />
    ) : offline ? (
      <Badge tone="offline" label={`${offline} offline`} />
    ) : (
      <Badge tone="online" label="All online" />
    );

  const menu: DropdownMenuItem[][] = [
    [
      { label: "View its devices", icon: <Cpu size={15} />, onClick: () => router.push(`/devices?zone=${zone.id}`) },
      {
        label: "Copy link",
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/zones/${zone.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
      },
    ],
    ...(canWrite ? [[{ label: "Delete zone…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(zone) }]] : []),
  ];

  return (
    <>
      <PeekFrame
        mode={mode}
        noun="zone"
        title={zone.name}
        eyebrow={<>Zone {status}</>}
        description={zone.notes || undefined}
        facts={[
          ["Devices", zone.device_count ? <Link href={`/devices?zone=${zone.id}`} className="text-accent hover:underline">{plural(zone.device_count, "device")}</Link> : "None yet"],
          ["Offline", zone.device_count ? (offline ? plural(offline, "device") : "None") : null],
        ]}
        primary={
          <Link href={`/zones/${zone.id}`} className={buttonClassName({ size: "sm" })}>
            <Pencil aria-hidden size={14} />
            {canWrite ? "Edit zone" : "View zone"}
          </Link>
        }
        menu={menu}
        onClose={onClose}
      />
      {dialog}
    </>
  );
}
