"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Table, type TableColumn } from "@/components/ui/Table";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ConnectionState = DeviceResponse["connection_state"];

const STATUS_OPTIONS: { value: ConnectionState | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "never_connected", label: "Never connected" },
];

export default function DevicesPage() {
  const router = useRouter();
  const api = useApi();
  const isAdmin = useIsAdmin();
  const searchParams = useSearchParams();

  const { data: devices, error, isLoading, mutate } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: catalogEntries } = useApiSWR<CatalogEntryResponse[]>("/catalog");

  const { confirm, dialog } = useConfirm();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") ?? "all");
  const [statusFilter, setStatusFilter] = useState<ConnectionState | "all">("all");
  const [revealed, setRevealed] = useState<{ deviceName: string; credential: DeviceCreateResponse["credential"] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const catalogNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of catalogEntries ?? []) map.set(e.id, e.name);
    return map;
  }, [catalogEntries]);

  const filtered = useMemo(() => {
    if (!devices) return [];
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && d.catalog_entry_id !== typeFilter) return false;
      if (statusFilter !== "all" && d.connection_state !== statusFilter) return false;
      return true;
    });
  }, [devices, search, typeFilter, statusFilter]);

  async function toggleStatus(device: DeviceResponse) {
    await api.patch(`/devices/${device.id}`, {
      status: device.status === "active" ? "disabled" : "active",
    });
    await mutate();
  }

  async function regenerateCredential(device: DeviceResponse) {
    const result = await api.post<DeviceCreateResponse>(`/devices/${device.id}/rotate-credential`);
    setRevealed({ deviceName: device.name, credential: result.credential });
  }

  async function remove(device: DeviceResponse) {
    if (!(await confirm(`Delete ${device.name}? This cannot be undone.`))) return;
    setActionError(null);
    try {
      await api.delete(`/devices/${device.id}`);
      await mutate();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete this device.");
    }
  }

  const columns: TableColumn<DeviceResponse>[] = [
    {
      header: "Name",
      render: (d) => (
        <Link href={`/devices/${d.id}`} className="font-medium text-ink hover:text-accent">
          {d.name}
        </Link>
      ),
    },
    { header: "Template", render: (d) => catalogNameById.get(d.catalog_entry_id) ?? "—" },
    {
      header: "Status",
      render: (d) => (
        <div className="flex items-center gap-2">
          <ConnectionBadge state={d.connection_state} />
          {d.status === "disabled" && <Badge tone="unknown" label="Disabled" />}
        </div>
      ),
    },
    {
      header: "",
      className: "w-10 text-right",
      render: (d) => {
        const items: DropdownMenuItem[][] = [
          [
            { label: "View Device", onClick: () => router.push(`/devices/${d.id}`) },
            { label: "Edit", onClick: () => router.push(`/devices/${d.id}?tab=settings`) },
            {
              label: "Duplicate",
              onClick: () =>
                router.push(
                  `/devices/new?catalog_entry_id=${d.catalog_entry_id}&name=${encodeURIComponent(`${d.name} copy`)}`,
                ),
            },
          ],
          [{ label: "Regenerate Credentials", onClick: () => void regenerateCredential(d) }],
        ];
        if (isAdmin) {
          items.push([
            { label: d.status === "active" ? "Disable" : "Enable", onClick: () => void toggleStatus(d) },
            { label: "Delete", danger: true, onClick: () => void remove(d) },
          ]);
        }
        return <DropdownMenu groups={items} label={`Actions for ${d.name}`} />;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Devices"
        actions={
          <Link href="/devices/new" className={buttonClassName()}>
            Add device
          </Link>
        }
      />

      {revealed && (
        <div className="rounded-xl border border-status-pending/40 bg-status-pending/10 p-4">
          <p className="text-sm font-medium text-ink">
            New credential for {revealed.deviceName} — copy it now, it will not be shown again.
          </p>
          <p className="mt-1 font-mono text-sm text-ink">{revealed.credential.username}</p>
          <p className="font-mono text-sm text-ink">{revealed.credential.password}</p>
          <div className="mt-2 flex gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `username: ${revealed.credential.username}\npassword: ${revealed.credential.password}`,
                )
              }
            >
              Copy
            </Button>
            <button type="button" onClick={() => setRevealed(null)} className="text-sm text-ink-muted">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {devices && devices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            compact
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices…"
          />
          <Select compact value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All templates</option>
            {catalogEntries?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Select
            compact
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ConnectionState | "all")}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {isLoading && <LoadingSkeleton rows={4} rowClassName="h-12" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load devices."}
          onRetry={() => void mutate()}
        />
      )}

      {actionError && <ErrorState message={actionError} />}

      {devices && devices.length === 0 && (
        <EmptyState
          title="No devices yet"
          description="Register your first device to start seeing live data."
          action={
            <Link href="/devices/new" className={buttonClassName({ variant: "ghost" })}>
              Add your first device →
            </Link>
          }
        />
      )}

      {devices && devices.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matching devices" description="Try a different search or filter." />
      )}

      {filtered.length > 0 && <Table columns={columns} rows={filtered} rowKey={(d) => d.id} />}

      {dialog}
    </div>
  );
}
