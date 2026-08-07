"use client";

import { useMemo, useState } from "react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useApi } from "@/hooks/useApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { parseAction } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  return String(value);
}

function ActuatorRow({
  deviceId,
  actuator,
  deviceOnline,
  isAdmin,
  latest,
  onSent,
}: {
  deviceId: string;
  actuator: string;
  deviceOnline: boolean;
  isAdmin: boolean;
  latest: CommandResponse | undefined;
  onSent: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentValue = latest?.value ?? false;
  const confirmed = latest != null && latest.acked_at != null;

  async function send(nextValue: boolean) {
    if (!confirm(`Turn ${actuator} ${nextValue ? "ON" : "OFF"}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/devices/${deviceId}/commands`, { actuator, value: nextValue });
      onSent();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send this command.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink">{actuator}</span>
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(!(currentValue === true))}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            Turn {currentValue === true ? "OFF" : "ON"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm text-ink-muted">
        {latest ? (
          <>
            <span>
              Requested <span className="text-ink">{formatValue(latest.value)}</span>
            </span>
            <span aria-hidden>·</span>
            {confirmed ? (
              <span className="text-status-online">Confirmed</span>
            ) : (
              <span className="text-status-pending">Pending</span>
            )}
          </>
        ) : (
          <span>No commands sent yet.</span>
        )}
      </div>

      {/* Honest offline behaviour (UX_UI_Description.md §7): the command still
          gets accepted (it applies via retained desired-state on reconnect),
          but this is never worded as success while the device is offline. */}
      {!deviceOnline && (
        <p className="text-xs text-status-pending">
          Device is offline — a command will be queued and applied once it reconnects.
        </p>
      )}

      {error && <ErrorState message={error} />}
    </div>
  );
}

export function ActuatorControl({
  deviceId,
  deviceOnline,
}: {
  deviceId: string;
  deviceOnline: boolean;
}) {
  const isAdmin = useIsAdmin();
  const { data: rules, isLoading: rulesLoading } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  // A fallback, not the primary freshness mechanism — useRealtime's
  // command_ack messages revalidate this same key the moment an ack lands.
  const { data: commands, mutate: mutateCommands } = useApiSWR<CommandResponse[]>(
    `/devices/${deviceId}/commands`,
    { refreshInterval: 20_000 },
  );

  const actuators = useMemo(() => {
    const set = new Set<string>();
    for (const rule of rules ?? []) {
      const action = parseAction(rule.action);
      if (action?.type === "actuator_command") set.add(action.actuator);
    }
    return Array.from(set);
  }, [rules]);

  if (rulesLoading) return <LoadingSkeleton rows={2} rowClassName="h-24" />;

  // Only known-to-exist actuators are shown — no speculative fixed list
  // (UX_UI_Description.md §3's "only render what's known to exist").
  if (actuators.length === 0) {
    return (
      <EmptyState
        title="No actuators configured"
        description="Add a device-command rule to control an actuator manually."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {actuators.map((actuator) => (
        <ActuatorRow
          key={actuator}
          deviceId={deviceId}
          actuator={actuator}
          deviceOnline={deviceOnline}
          isAdmin={isAdmin}
          latest={commands?.find((c) => c.actuator === actuator)}
          onSent={() => void mutateCommands()}
        />
      ))}
    </div>
  );
}
