"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Badge } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Table, type TableColumn } from "@/components/ui/Table";
import { TableNameCell } from "@/components/ui/TableNameCell";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

/** Unique devices a rule touches, in a stable order. */
function ruleDevices(rule: RuleResponse): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const d of rule.devices) {
    if (!seen.has(d.device_id)) seen.set(d.device_id, d.device_name ?? "Unnamed device");
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

function DeviceLine({ devices }: { devices: { id: string; name: string }[] }) {
  if (devices.length === 0) return <span className="text-xs text-ink-muted">no devices</span>;
  const shown = devices.slice(0, 3);
  const extra = devices.length - shown.length;
  return (
    <span className="text-xs text-ink-muted">
      {shown.map((d) => d.name).join(" · ")}
      {extra > 0 && ` +${extra}`}
    </span>
  );
}

export default function RulesPage() {
  const api = useApi();
  const router = useRouter();
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleResponse[]>("/rules");
  const isAdmin = useIsAdmin();
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const deviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rules ?? []) {
      for (const d of ruleDevices(r)) map.set(d.id, d.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [rules]);

  const filtered = useMemo(() => {
    if (!rules) return [];
    const q = filter.trim().toLowerCase();
    return rules.filter((r) => {
      const devices = ruleDevices(r);
      if (deviceFilter !== "all" && !devices.some((d) => d.id === deviceFilter)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        devices.some((d) => d.name.toLowerCase().includes(q))
      );
    });
  }, [rules, filter, deviceFilter]);

  // A rule's device pages cache their rules under a different SWR key
  // (`/devices/{id}/rules`) — revalidate each so none is left stale.
  function onChanged(rule: RuleResponse) {
    void mutate();
    for (const d of rule.devices) void revalidate(`/devices/${d.device_id}/rules`);
  }

  async function toggleEnabled(rule: RuleResponse) {
    setActionError(null);
    try {
      await api.patch(`/rules/${rule.id}`, { enabled: !rule.enabled });
      onChanged(rule);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't update this rule.");
    }
  }

  async function remove(rule: RuleResponse) {
    if (!(await confirm("Delete this rule? This cannot be undone."))) return;
    setActionError(null);
    try {
      await api.delete(`/rules/${rule.id}`);
      onChanged(rule);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete this rule.");
    }
  }

  const columns: TableColumn<RuleResponse>[] = [
    {
      header: "Rule",
      render: (r) => (
        <TableNameCell
          href={`/rules/${r.id}`}
          name={r.name}
          sublabel={<DeviceLine devices={ruleDevices(r)} />}
        />
      ),
    },
    {
      header: "Status",
      render: (r) => (
        <Badge
          tone={r.enabled ? "online" : "unknown"}
          variant="dot"
          label={r.enabled ? "Enabled" : "Disabled"}
        />
      ),
    },
  ];
  if (isAdmin) {
    columns.push({
      header: "",
      className: "w-10 text-right",
      render: (r) => {
        const items: DropdownMenuItem[][] = [
          [{ label: "Edit", onClick: () => router.push(`/rules/${r.id}`) }],
          [
            { label: r.enabled ? "Disable" : "Enable", onClick: () => void toggleEnabled(r) },
            { label: "Delete", danger: true, onClick: () => void remove(r) },
          ],
        ];
        return <DropdownMenu groups={items} label={`Actions for ${r.name}`} />;
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Rules"
        actions={
          isAdmin && (
            <Link href="/rules/new" className={buttonClassName()}>
              Create Rule
            </Link>
          )
        }
      />

      {actionError && <ErrorState message={actionError} />}

      {rules && rules.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            compact
            className="bg-surface"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or device…"
          />
          <Select
            compact
            className="bg-surface"
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
          >
            <option value="all">All devices</option>
            {deviceOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {isLoading && <LoadingSkeleton rows={4} rowClassName="h-20" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load rules."}
          onRetry={() => void mutate()}
        />
      )}

      {rules && rules.length === 0 && (
        <EmptyState
          title="No rules yet"
          description="Rules watch metrics and fire an action when a condition is met."
          action={
            isAdmin ? (
              <Link href="/rules/new" className={buttonClassName({ variant: "ghost" })}>
                Add a rule →
              </Link>
            ) : undefined
          }
        />
      )}

      {rules && rules.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matching rules" description="Try a different search term." />
      )}

      {filtered.length > 0 && <Table columns={columns} rows={filtered} rowKey={(r) => r.id} />}

      {dialog}
    </div>
  );
}
