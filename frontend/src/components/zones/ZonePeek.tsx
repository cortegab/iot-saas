"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cpu, Link2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekOpen, PeekPlaceholder } from "@/components/editor/PeekFrame";
import { PeekDeviceList } from "@/components/devices/PeekDeviceList";
import { useDeleteZone } from "./useDeleteZone";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A zone at a glance beside the list; editing happens on /zones/{id}. */
export function ZonePeek({ zone, offline, onClose }: { zone: ZoneResponse | undefined; offline: number; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("zones.write");
  const { menuItem, dialog } = useDeleteZone(onClose);

  if (!zone) return <PeekPlaceholder noun="zone" missing onClose={onClose} />;

  const status =
    zone.device_count === 0 ? (
      <Badge tone="unknown" shape="square" label="No devices" />
    ) : offline ? (
      <Badge tone="offline" label={`${offline} offline`} />
    ) : (
      <Badge tone="online" label="All reporting" />
    );

  const menu: DropdownMenuItem[][] = [
    [
      { label: "View devices", icon: <Cpu size={15} />, onClick: () => router.push(`/devices?zone=${zone.id}`) },
      {
        label: "Copy link",
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/zones/${zone.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
      },
    ],
    ...(canWrite ? [[menuItem(zone)]] : []),
  ];

  return (
    <>
      <PeekFrame
        noun="zone"
        title={zone.name}
        eyebrow={status}
        description={zone.notes || undefined}
        facts={[
          ["Devices", zone.device_count ? <Link href={`/devices?zone=${zone.id}`} className="text-accent hover:underline">{plural(zone.device_count, "device")}</Link> : "None yet"],
          ["Offline", zone.device_count ? (offline ? plural(offline, "device") : "None") : null],
        ]}
        primary={<PeekOpen href={`/zones/${zone.id}`} noun="zone" />}
        menu={menu}
        onClose={onClose}
      >
        <PeekDeviceList match={(d) => d.zone_id === zone.id} allHref={`/devices?zone=${zone.id}`} />
      </PeekFrame>
      {dialog}
    </>
  );
}
