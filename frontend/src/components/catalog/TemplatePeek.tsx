"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Cpu, Link2, Pencil, Power, Trash2 } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekPlaceholder, PeekSection, type PeekMode } from "@/components/editor/PeekFrame";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogUsageResponse = components["schemas"]["CatalogUsageResponse"];
type KeyUsageResponse = components["schemas"]["KeyUsageResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function usedBy(u: KeyUsageResponse | undefined): string | null {
  if (!u || (u.rules === 0 && u.widgets === 0)) return null;
  return [u.rules && plural(u.rules, "rule"), u.widgets && plural(u.widgets, "widget")].filter(Boolean).join(", ");
}

function KeyList({ items, usage }: { items: { key: string; label: string; unit?: string | null }[]; usage: Record<string, KeyUsageResponse> | undefined }) {
  if (items.length === 0) return <p className="text-[13px] text-ink-muted">None.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border-soft rounded-lg border border-border">
      {items.map((it) => {
        const used = usedBy(usage?.[it.key]);
        return (
          <li key={it.key} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
            <span className="flex min-w-0 items-center gap-2">
              <Tag mono>{it.key}</Tag>
              <span className="truncate text-ink-muted">
                {it.label}
                {it.unit ? ` · ${it.unit}` : ""}
              </span>
            </span>
            {used && <span className="whitespace-nowrap text-[12px] text-ink-muted">{used}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** A device template at a glance: what it reports and controls, and what
 * depends on each key. It's edited on /templates/{id}. */
export function TemplatePeek({
  entry,
  mode,
  onClose,
  onToggle,
  onDelete,
}: {
  entry: CatalogEntryResponse | undefined;
  mode: PeekMode;
  onClose: () => void;
  onToggle: (e: CatalogEntryResponse) => void;
  onDelete: (e: CatalogEntryResponse) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("templates.write");
  const { data: usage } = useApiSWR<CatalogUsageResponse>(entry ? `/catalog/${entry.id}/usage` : null);
  if (!entry) return <PeekPlaceholder mode={mode} noun="template" missing onClose={onClose} />;

  const menu: DropdownMenuItem[][] = [
    [
      { label: "View devices", icon: <Cpu size={15} />, onClick: () => router.push(`/devices?template=${entry.id}`) },
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
      mode={mode}
      noun="template"
      title={entry.name}
      eyebrow={
        <>
          Device template{" "}
          {entry.status === "active" ? <Badge tone="online" label="Enabled" /> : <Badge tone="unknown" shape="square" label="Disabled" />}
          {entry.is_legacy && <Tag size="sm">Legacy</Tag>}
        </>
      }
      facts={[
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
          <Pencil aria-hidden size={14} /> {canWrite ? "Edit template" : "View template"}
        </Link>
      }
      menu={menu}
      onClose={onClose}
    >
      <PeekSection title={`Metrics · ${entry.metrics.length}`}>
        <KeyList items={entry.metrics.map((m) => ({ key: m.key ?? m.name, label: m.name, unit: m.unit }))} usage={usage?.metrics} />
      </PeekSection>
      <PeekSection title={`Actuators · ${entry.actuators.length}`}>
        <KeyList items={entry.actuators.map((a) => ({ key: a.key ?? a.name, label: a.name }))} usage={usage?.actuators} />
      </PeekSection>
    </PeekFrame>
  );
}
