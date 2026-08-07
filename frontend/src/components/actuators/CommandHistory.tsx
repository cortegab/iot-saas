"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
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

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Actuator</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2 font-medium">Sent</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="px-3 py-2 text-ink">{c.actuator}</td>
              <td className="px-3 py-2 text-ink">{formatValue(c.value)}</td>
              <td className="px-3 py-2 text-ink-muted">{new Date(c.published_at).toLocaleString()}</td>
              <td className="px-3 py-2 text-ink-muted">{c.rule_id ? "Rule" : "Manual"}</td>
              <td className="px-3 py-2">
                {c.acked_at ? (
                  <span className="text-status-online">Confirmed</span>
                ) : (
                  <span className="text-status-pending">Pending</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
