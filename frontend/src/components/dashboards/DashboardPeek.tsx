"use client";

import Link from "next/link";
import { Copy, LayoutGrid, Link2, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekPlaceholder, type PeekMode } from "@/components/editor/PeekFrame";
import { widgetSummary } from "@/lib/dashboard-summary";
import { formatWhen, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A dashboard at a glance; it's opened, arranged and renamed on its page. */
export function DashboardPeek({
  dashboard,
  mode,
  onClose,
  onDuplicate,
  onDelete,
}: {
  dashboard: DashboardResponse | undefined;
  mode: PeekMode;
  onClose: () => void;
  onDuplicate: (d: DashboardResponse) => void;
  onDelete: (d: DashboardResponse) => void;
}) {
  const toast = useToast();
  if (!dashboard) return <PeekPlaceholder mode={mode} noun="dashboard" missing onClose={onClose} />;

  const devices = new Set(dashboard.layout.map((w) => w.device_id)).size;
  const menu: DropdownMenuItem[][] = [
    [
      { label: "Duplicate", icon: <Copy size={15} />, onClick: () => onDuplicate(dashboard) },
      {
        label: "Copy link",
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/dashboards/${dashboard.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
      },
    ],
    [{ label: "Delete dashboard…", icon: <Trash2 size={15} />, danger: true, onClick: () => onDelete(dashboard) }],
  ];

  return (
    <PeekFrame
      mode={mode}
      noun="dashboard"
      title={dashboard.name}
      eyebrow="Dashboard · only you see it"
      description={widgetSummary(dashboard.layout)}
      facts={[
        ["Widgets", String(dashboard.layout.length)],
        ["Devices", devices ? plural(devices, "device") : "None yet"],
        ["Updated", <span key="u" title={formatWhen(dashboard.updated_at)}>{timeAgo(dashboard.updated_at)}</span>],
      ]}
      primary={
        <>
          <Link href={`/dashboards/${dashboard.id}`} className={buttonClassName({ size: "sm" })}>
            <SquareArrowOutUpRight aria-hidden size={14} /> Open
          </Link>
          <Link href={`/dashboards/${dashboard.id}?edit=1`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            <LayoutGrid aria-hidden size={14} /> {dashboard.layout.length ? "Edit layout" : "Add widgets"}
          </Link>
        </>
      }
      menu={menu}
      onClose={onClose}
    />
  );
}
