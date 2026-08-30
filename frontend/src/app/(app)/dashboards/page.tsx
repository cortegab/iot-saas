"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, type TableColumn } from "@/components/ui/Table";
import { TableNameCell } from "@/components/ui/TableNameCell";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

export default function DashboardsPage() {
  const router = useRouter();
  const api = useApi();
  const isAdmin = useIsAdmin();
  const { confirm, dialog } = useConfirm();
  const { data: dashboards, error, isLoading, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!dashboards) return [];
    const q = search.trim().toLowerCase();
    if (!q) return dashboards;
    return dashboards.filter((d) => d.name.toLowerCase().includes(q));
  }, [dashboards, search]);

  async function remove(dashboard: DashboardResponse) {
    if (!(await confirm(`Delete "${dashboard.name}"? This cannot be undone.`))) return;
    setActionError(null);
    try {
      await api.delete(`/dashboards/${dashboard.id}`);
      void mutate();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete this dashboard.");
    }
  }

  const columns: TableColumn<DashboardResponse>[] = [
    {
      header: "Name",
      render: (d) => (
        <TableNameCell
          href={`/dashboards/${d.id}`}
          name={d.name}
          sublabel={`${d.layout.length} widget${d.layout.length === 1 ? "" : "s"} · updated ${new Date(
            d.updated_at,
          ).toLocaleDateString()}`}
        />
      ),
    },
  ];
  if (isAdmin) {
    columns.push({
      header: "",
      className: "w-10 text-right",
      render: (d) => {
        const items: DropdownMenuItem[][] = [
          [{ label: "Edit", onClick: () => router.push(`/dashboards/${d.id}`) }],
          [{ label: "Delete", danger: true, onClick: () => void remove(d) }],
        ];
        return <DropdownMenu groups={items} label={`Actions for ${d.name}`} />;
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboards"
        actions={
          isAdmin && (
            <Link href="/dashboards/new" className={buttonClassName()}>
              Add Dashboard
            </Link>
          )
        }
      />

      {actionError && <ErrorState message={actionError} />}

      {dashboards && dashboards.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            compact
            className="bg-surface"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dashboards…"
          />
        </div>
      )}

      {isLoading && <LoadingSkeleton rows={3} rowClassName="h-16" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load dashboards."}
          onRetry={() => void mutate()}
        />
      )}

      {dashboards && dashboards.length === 0 && (
        <EmptyState
          title="No dashboards yet"
          description="Create one and add widgets for the devices you care about most."
          action={
            isAdmin ? (
              <Link href="/dashboards/new" className={buttonClassName({ variant: "ghost" })}>
                Add a dashboard →
              </Link>
            ) : undefined
          }
        />
      )}

      {dashboards && dashboards.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matching dashboards" description="Try a different search term." />
      )}

      {filtered.length > 0 && <Table columns={columns} rows={filtered} rowKey={(d) => d.id} />}

      {dialog}
    </div>
  );
}
