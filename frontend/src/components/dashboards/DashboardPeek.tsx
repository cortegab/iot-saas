"use client";

import Link from "next/link";
import { Copy, LayoutGrid, Link2, Trash2 } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekOpen, PeekPlaceholder } from "@/components/editor/PeekFrame";
import { useDefaultDashboard } from "@/components/dashboards/useDefaultDashboard";
import { usePermissions } from "@/hooks/usePermissions";
import { widgetSummary } from "@/lib/dashboard-summary";
import { formatWhen, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type DashboardResponse = components["schemas"]["DashboardResponse"];


/** A dashboard at a glance; it's opened, arranged and renamed on its page. */
export function DashboardPeek({
  dashboard,
  onClose,
  onDuplicate,
  onDelete,
}: {
  dashboard: DashboardResponse | undefined;
  onClose: () => void;
  onDuplicate: (d: DashboardResponse) => void;
  onDelete: (d: DashboardResponse) => void;
}) {
  const toast = useToast();
  const defaults = useDefaultDashboard();
  const canWrite = usePermissions().can("dashboards.write");
  if (!dashboard) return <PeekPlaceholder noun="dashboard" missing onClose={onClose} />;

  const devices = new Set(dashboard.layout.map((w) => w.device_id)).size;
  const menu: DropdownMenuItem[][] = [
    [
      defaults.item(dashboard),
      ...(canWrite ? [{ label: tr("wsheet.duplicate"), icon: <Copy size={15} />, onClick: () => onDuplicate(dashboard) }] : []),
      {
        label: tr("wsheet.copyLink"),
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/dashboards/${dashboard.id}`).then(() => toast({ tone: "info", title: tr("wsheet.linkCopied") })),
      },
    ],
    ...(canWrite ? [[{ label: tr("wsheet.delete"), icon: <Trash2 size={15} />, danger: true, onClick: () => onDelete(dashboard) }]] : []),
  ];

  return (
    <PeekFrame
      noun="dashboard"
      title={dashboard.name}
      eyebrow={dashboard.is_default ? tr("wsheet.yourDefault") : tr("wsheet.shared")}
      description={widgetSummary(dashboard.layout)}
      facts={[
        [tr("wsheet.widgets"), String(dashboard.layout.length)],
        [tr("wsheet.devices"), devices ? tr("wsheet.deviceCount", { count: devices }) : tr("wsheet.noneYet")],
        [tr("wsheet.updated"), <span key="u" title={formatWhen(dashboard.updated_at)}>{timeAgo(dashboard.updated_at)}</span>],
      ]}
      primary={
        <>
          <PeekOpen href={`/dashboards/${dashboard.id}`} noun="dashboard" />
          {canWrite && (
            <Link href={`/dashboards/${dashboard.id}?edit=1`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
              <LayoutGrid aria-hidden size={14} /> {dashboard.layout.length ? tr("wsheet.editLayout") : tr("wsheet.addWidgets")}
            </Link>
          )}
        </>
      }
      menu={menu}
      onClose={onClose}
    />
  );
}
