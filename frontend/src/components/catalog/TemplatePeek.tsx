"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Copy, Cpu, Link2, Pencil, Power, Trash2 } from "lucide-react";
import { resolveModel } from "@/lib/hardware/board-pins";
import { findDriver, useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekPlaceholder, PeekSection } from "@/components/editor/PeekFrame";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
      { label: "View devices", icon: <Cpu size={15} />, onClick: () => router.push(`/devices?template=${entry.id}`) },
      ...(entry.runs_on === "generic_firmware" && entry.hardware ? [{ label: "Wiring guide", icon: <BookOpen size={15} />, onClick: () => router.push(`/templates/${entry.id}/wiring`) }] : []),
      {
        label: "Copy link",
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/templates/${entry.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
      },
      ...(canWrite ? [{ label: "Duplicate", icon: <Copy size={15} />, onClick: () => router.push(`/templates/new?duplicate=${entry.id}`) }] : []),
    ],
    ...(canWrite
      ? [
          [{ label: entry.status === "active" ? "Disable" : "Enable", icon: <Power size={15} />, onClick: () => onToggle(entry) }],
          [
            {
              label: "Delete…",
              icon: <Trash2 size={15} />,
              danger: true,
              hint: entry.device_count ? `${plural(entry.device_count, "device uses", "devices use")} it` : undefined,
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
          Device template{" "}
          {entry.status === "active" ? <Badge tone="online" variant="dot" label="Enabled" /> : <Badge tone="unknown" shape="square" variant="dot" label="Disabled" />}
          {entry.is_legacy && <Tag size="sm">Legacy</Tag>}
        </>
      }
      facts={[
        ["Runs on", entry.runs_on === "generic_firmware" ? "Our firmware" : "Custom firmware"],
        ["Board", entry.hardware ? (resolveModel(driverCatalog?.models, entry.hardware.board)?.label ?? entry.hardware.board) : null],
        ["Parts", entry.hardware ? [...(entry.hardware.inputs ?? []), ...(entry.hardware.outputs ?? [])].map((b) => findDriver(driverCatalog?.drivers, b.driver)?.label ?? b.driver).join(", ") || "None" : null],
        [
          "Devices",
          entry.device_count ? (
            <Link href={`/devices?template=${entry.id}`} className="text-accent hover:underline">
              {plural(entry.device_count, "device")}
            </Link>
          ) : (
            "None yet"
          ),
        ],
        ["Updated", timeAgo(entry.updated_at)],
      ]}
      primary={
        <Link href={`/templates/${entry.id}`} className={buttonClassName({ size: "sm" })}>
          <Pencil aria-hidden size={14} /> {canWrite ? "Edit" : "View"}
        </Link>
      }
      menu={menu}
      onClose={onClose}
    >
      <PeekSection title="What you'll see">
        <dl className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]">
          <dt className="text-ink-muted">Metrics</dt>
          <dd className="m-0 text-ink">
            {entry.metrics.length ? entry.metrics.map((m) => `${m.name}${m.unit && m.data_type !== "bool" ? ` ${m.unit}` : m.data_type === "bool" ? " On/Off" : ""}`).join(", ") : <span className="text-ink-muted">None</span>}
          </dd>
          <dt className="text-ink-muted">Actuators</dt>
          <dd className="m-0 text-ink">{entry.actuators.length ? entry.actuators.map((a) => a.name).join(", ") : <span className="text-ink-muted">None</span>}</dd>
        </dl>
      </PeekSection>
    </PeekFrame>
  );
}
