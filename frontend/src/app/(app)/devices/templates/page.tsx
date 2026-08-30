"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Badge } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Table, type TableColumn } from "@/components/ui/Table";
import { TableNameCell } from "@/components/ui/TableNameCell";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const STATUS_OPTIONS: { value: CatalogEntryResponse["status"] | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

/** The row sub-line under a template name — "3 metrics · 1 actuator". */
function summarizeShape(e: CatalogEntryResponse): string {
  const m = (e.metrics ?? []).length;
  const a = (e.actuators ?? []).length;
  if (m === 0 && a === 0) return "No metrics or actuators yet";
  const parts: string[] = [];
  if (m) parts.push(`${m} metric${m === 1 ? "" : "s"}`);
  if (a) parts.push(`${a} actuator${a === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export default function DeviceCatalogPage() {
  const router = useRouter();
  const api = useApi();
  const isAdmin = useIsAdmin();
  const { data: entries, error, isLoading, mutate } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const { confirm, dialog } = useConfirm();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CatalogEntryResponse["status"] | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      return true;
    });
  }, [entries, search, statusFilter]);

  async function toggleStatus(entry: CatalogEntryResponse) {
    await api.patch(`/catalog/${entry.id}`, {
      status: entry.status === "active" ? "disabled" : "active",
    });
    await mutate();
  }

  async function remove(entry: CatalogEntryResponse) {
    if (!(await confirm(`Delete "${entry.name}"? This cannot be undone.`))) return;
    setActionError(null);
    try {
      await api.delete(`/catalog/${entry.id}`);
      await mutate();
    } catch (err) {
      // 409 when devices still reference this entry.
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete this template.");
    }
  }

  const columns: TableColumn<CatalogEntryResponse>[] = [
    {
      header: "Name",
      render: (e) => (
        <TableNameCell
          href={`/devices/templates/${e.id}`}
          name={e.name}
          trailing={e.is_legacy && <Badge tone="unknown" label="Legacy" className="ml-2" />}
          sublabel={summarizeShape(e)}
        />
      ),
    },
    { header: "Devices", render: (e) => e.device_count },
    {
      header: "Status",
      render: (e) => (
        <Badge
          tone={e.status === "active" ? "online" : "unknown"}
          variant="dot"
          label={e.status === "active" ? "Active" : "Disabled"}
        />
      ),
    },
    {
      header: "",
      className: "w-10 text-right",
      render: (e) => {
        const items: DropdownMenuItem[][] = [
          [
            { label: "Edit", onClick: () => router.push(`/devices/templates/${e.id}`) },
            { label: "Duplicate", onClick: () => router.push(`/devices/templates/new?duplicate=${e.id}`) },
          ],
          [{ label: "View Devices", onClick: () => router.push(`/devices?type=${e.id}`) }],
        ];
        if (isAdmin) {
          items.push([
            {
              label: e.status === "active" ? "Disable" : "Enable",
              onClick: () => void toggleStatus(e),
            },
            { label: "Delete", danger: true, onClick: () => void remove(e) },
          ]);
        }
        return <DropdownMenu groups={items} label={`Actions for ${e.name}`} />;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Device Templates"
        subtitle="Define the metrics and actuators a device instantiates from."
        actions={
          isAdmin && (
            <Link href="/devices/templates/new" className={buttonClassName()}>
              Create Template
            </Link>
          )
        }
      />

      {entries && entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            compact
            className="bg-surface"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
          />
          <Select
            compact
            className="bg-surface"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CatalogEntryResponse["status"] | "all")}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {isLoading && <LoadingSkeleton rows={3} rowClassName="h-12" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load templates."}
          onRetry={() => void mutate()}
        />
      )}

      {actionError && <ErrorState message={actionError} />}

      {entries && entries.length === 0 && (
        <EmptyState title="No templates yet" description="Create one to define a device template." />
      )}

      {entries && entries.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matching templates" description="Try a different search or filter." />
      )}

      {filtered.length > 0 && <Table columns={columns} rows={filtered} rowKey={(e) => e.id} />}

      {dialog}
    </div>
  );
}
