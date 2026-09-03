"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Table, type TableColumn } from "@/components/ui/Table";
import { TableNameCell } from "@/components/ui/TableNameCell";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

const COLUMNS: TableColumn<RuleResponse>[] = [
  { header: "Rule", render: (r) => <TableNameCell href={`/rules/${r.id}`} name={r.name} /> },
  {
    header: "Status",
    render: (r) => (
      <Badge tone={r.enabled ? "online" : "unknown"} variant="dot" label={r.enabled ? "Enabled" : "Disabled"} />
    ),
  },
];

/** This device's rules, applied here but managed from /rules — each row links
 * to the rule editor; there's no inline enable/delete on the device page. */
export function RuleList({ deviceId }: { deviceId: string }) {
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);

  if (isLoading) return <LoadingSkeleton rows={2} rowClassName="h-20" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load rules."}
        onRetry={() => void mutate()}
      />
    );
  }

  if (!rules || rules.length === 0) {
    return (
      <EmptyState
        title="No rules yet"
        description="Rules watch a metric and fire an action when it crosses a threshold."
      />
    );
  }

  return <Table columns={COLUMNS} rows={rules} rowKey={(r) => r.id} />;
}
