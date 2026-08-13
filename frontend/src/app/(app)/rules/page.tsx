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
import { ApiRequestError } from "@/lib/api-client";
import { RuleSummary, leafPredicates } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleWithDeviceResponse = components["schemas"]["RuleWithDeviceResponse"];

export default function RulesPage() {
  const api = useApi();
  const router = useRouter();
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleWithDeviceResponse[]>("/rules");
  const isAdmin = useIsAdmin();
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const deviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rules ?? []) map.set(r.device_id, r.device_name);
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [rules]);

  const filtered = useMemo(() => {
    if (!rules) return [];
    const q = filter.trim().toLowerCase();
    return rules.filter((r) => {
      if (deviceFilter !== "all" && r.device_id !== deviceFilter) return false;
      if (!q) return true;
      return (
        leafPredicates(r.condition).some((leaf) => leaf.metric.toLowerCase().includes(q)) ||
        r.device_name.toLowerCase().includes(q)
      );
    });
  }, [rules, filter, deviceFilter]);

  // A rule's own device page caches its rules under a different SWR key
  // (`/devices/{id}/rules`) — revalidate that too so it isn't left stale if
  // the user navigates there next.
  function onChanged(rule: RuleWithDeviceResponse) {
    void mutate();
    void revalidate(`/devices/${rule.device_id}/rules`);
  }

  async function toggleEnabled(rule: RuleWithDeviceResponse) {
    setActionError(null);
    try {
      await api.patch(`/rules/${rule.id}`, { enabled: !rule.enabled });
      onChanged(rule);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't update this rule.");
    }
  }

  async function remove(rule: RuleWithDeviceResponse) {
    if (!(await confirm("Delete this rule? This cannot be undone."))) return;
    setActionError(null);
    try {
      await api.delete(`/rules/${rule.id}`);
      onChanged(rule);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete this rule.");
    }
  }

  const columns: TableColumn<RuleWithDeviceResponse>[] = [
    { header: "Rule", render: (r) => <RuleSummary rule={r} /> },
    {
      header: "Device",
      render: (r) => (
        <Link href={`/devices/${r.device_id}`} className="font-medium text-ink hover:text-accent">
          {r.device_name}
        </Link>
      ),
    },
    {
      header: "Status",
      render: (r) => (
        <Badge tone={r.enabled ? "online" : "unknown"} variant="dot" label={r.enabled ? "Enabled" : "Disabled"} />
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
        return <DropdownMenu groups={items} label={`Actions for rule on ${r.device_name}`} />;
      },
    });
  }

  if (isLoading) return <LoadingSkeleton rows={4} rowClassName="h-20" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load rules."}
        onRetry={() => void mutate()}
      />
    );
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
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by metric or device…"
          />
          <Select compact value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)}>
            <option value="all">All devices</option>
            {deviceOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {!rules || rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          description="Rules watch a metric and fire an action when it crosses a threshold."
          action={
            isAdmin ? (
              <Link href="/rules/new" className={buttonClassName({ variant: "ghost" })}>
                Add a rule →
              </Link>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching rules" description="Try a different search term." />
      ) : (
        <Table columns={columns} rows={filtered} rowKey={(r) => r.id} />
      )}

      {dialog}
    </div>
  );
}
