"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Table, type TableColumn } from "@/components/ui/Table";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type CommandResponse = components["schemas"]["CommandResponse"];

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  return String(value);
}

/** Read-only audit trail — timestamps + confirmation status
 * (UX_UI_Description.md §7). useRealtime's command_ack messages revalidate
 * this key the moment an ack lands; the interval below is just a fallback. */
export function CommandHistory({ deviceId }: { deviceId: string }) {
  const { data, error, isLoading, mutate } = useApiSWR<CommandResponse[]>(
    `/devices/${deviceId}/commands`,
    { refreshInterval: 20_000 },
  );

  if (isLoading) return <LoadingSkeleton rows={3} rowClassName="h-10" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load command history."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!data || data.length === 0) {
    return <EmptyState title="No commands yet" description="Actuator commands, manual or rule-fired, appear here." />;
  }

  const columns: TableColumn<CommandResponse>[] = [
    { header: "Actuator", render: (c) => <span className="font-mono">{c.actuator}</span> },
    { header: "Value", render: (c) => <span className="font-mono">{formatValue(c.value)}</span> },
    {
      header: "Sent",
      render: (c) => <span className="text-ink-muted">{new Date(c.published_at).toLocaleString()}</span>,
    },
    { header: "Source", render: (c) => <span className="text-ink-muted">{c.rule_id ? "Rule" : "Manual"}</span> },
    {
      header: "Status",
      render: (c) =>
        c.acked_at ? (
          <Badge tone="online" variant="text" label="Confirmed" />
        ) : (
          <Badge tone="pending" variant="text" label="Pending" />
        ),
    },
  ];

  return <Table columns={columns} rows={data} rowKey={(c) => c.id} />;
}
