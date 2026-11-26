"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Copy, Cpu, Link2, Power, Trash2 } from "lucide-react";
import { resolveModel } from "@/lib/hardware/board-pins";
import { findDriver, useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekOpen, PeekPlaceholder, PeekSection } from "@/components/editor/PeekFrame";
import { PeekDeviceList } from "@/components/devices/PeekDeviceList";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];


/** A device template at a glance: what it reports and controls, and what
 * depends on each key. It's edited on /templates/{id}. */
export function TemplatePeek({
  entry,
  onClose,
  onToggle,
  onDelete,
}: {
  entry: CatalogEntryResponse | undefined;
  onClose: () => void;
  onToggle: (e: CatalogEntryResponse) => void;
  onDelete: (e: CatalogEntryResponse) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("templates.write");
  const { data: driverCatalog } = useDriverCatalog();
  if (!entry) return <PeekPlaceholder noun="template" missing onClose={onClose} />;

  const menu: DropdownMenuItem[][] = [
    [
      { label: tr("tpl.viewDevices"), icon: <Cpu size={15} />, onClick: () => router.push(`/devices?template=${entry.id}`) },
      ...(entry.runs_on === "generic_firmware" && entry.hardware ? [{ label: tr("tpl.wiringGuide"), icon: <BookOpen size={15} />, onClick: () => router.push(`/templates/${entry.id}/wiring`) }] : []),
      {
        label: tr("tlist.copyLink"),
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/templates/${entry.id}`).then(() => toast({ tone: "info", title: tr("tlist.linkCopied") })),
      },
      ...(canWrite ? [{ label: tr("tpl.duplicate"), icon: <Copy size={15} />, onClick: () => router.push(`/templates/new?duplicate=${entry.id}`) }] : []),
    ],
    ...(canWrite
      ? [
          [{ label: entry.status === "active" ? tr("tlist.disable") : tr("tlist.enable"), icon: <Power size={15} />, onClick: () => onToggle(entry) }],
          [
            {
              label: tr("tpl.delete"),
              icon: <Trash2 size={15} />,
              danger: true,
              hint: entry.device_count ? tr("tlist.usesIt", { count: entry.device_count }) : undefined,
              onClick: () => onDelete(entry),
            },
          ],
        ]
      : []),
  ];

  return (
    <PeekFrame
      noun="template"
      title={entry.name}
      eyebrow={
        <>
          {entry.status === "active" ? <Badge tone="online" variant="dot" label={tr("tpl.enabled")} /> : <Badge tone="unknown" shape="square" variant="dot" label={tr("tpl.disabled")} />}
          {entry.is_legacy && <Tag size="sm">{tr("tlist.legacy")}</Tag>}
        </>
      }
      facts={[
        [tr("tpl.runsOn"), entry.runs_on === "generic_firmware" ? tr("tpl.ourFirmware") : tr("tpl.customFirmware")],
        [tr("tlist.board"), entry.hardware ? (resolveModel(driverCatalog?.models, entry.hardware.board)?.label ?? entry.hardware.board) : null],
        [tr("tlist.parts"), entry.hardware ? [...(entry.hardware.inputs ?? []), ...(entry.hardware.outputs ?? [])].map((b) => findDriver(driverCatalog?.drivers, b.driver)?.label ?? b.driver).join(", ") || tr("tpl.none") : null],
        [
          tr("tlist.devices"),
          entry.device_count ? (
            <Link href={`/devices?template=${entry.id}`} className="text-accent hover:underline">
              {tr("tpl.devices", { count: entry.device_count })}
            </Link>
          ) : (
            tr("tlist.noneYet")
          ),
        ],
        [tr("tlist.updated"), timeAgo(entry.updated_at)],
      ]}
      primary={<PeekOpen href={`/templates/${entry.id}`} noun="template" />}
      menu={menu}
      onClose={onClose}
    >
      <PeekSection title={tr("hw.yields")}>
        <dl className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-4 gap-y-2 text-meta">
          <dt className="text-ink-muted">{tr("tpl.metrics")}</dt>
          <dd className="m-0 text-ink">
            {entry.metrics.length ? entry.metrics.map((m) => `${m.name}${m.unit && m.data_type !== "bool" ? ` ${m.unit}` : m.data_type === "bool" ? ` ${tr("tlist.onOff")}` : ""}`).join(", ") : <span className="text-ink-muted">{tr("tpl.none")}</span>}
          </dd>
          <dt className="text-ink-muted">{tr("tpl.actuators")}</dt>
          <dd className="m-0 text-ink">{entry.actuators.length ? entry.actuators.map((a) => a.name).join(", ") : <span className="text-ink-muted">{tr("tpl.none")}</span>}</dd>
        </dl>
      </PeekSection>
      <PeekDeviceList match={(d) => d.catalog_entry_id === entry.id} allHref={`/devices?template=${entry.id}`} />
    </PeekFrame>
  );
}
