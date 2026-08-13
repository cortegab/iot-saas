"use client";

import { useMemo, useState } from "react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useApi } from "@/hooks/useApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { parseAction } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

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
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentValue = latest?.value ?? false;
  const confirmed = latest != null && latest.acked_at != null;

  async function send(nextValue: boolean) {
    const ok = await confirm(`Turn ${actuator} ${nextValue ? "ON" : "OFF"}?`, {
      danger: false,
      confirmLabel: nextValue ? "Turn ON" : "Turn OFF",
    });
    if (!ok) return;
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
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink">{actuator}</span>
        {isAdmin && (
          <Button disabled={busy} onClick={() => void send(!(currentValue === true))}>
            Turn {currentValue === true ? "OFF" : "ON"}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm text-ink-muted">
        {latest ? (
          <>
            <span>
              Requested <span className="text-ink">{formatValue(latest.value)}</span>
            </span>
            <span aria-hidden>·</span>
            <Badge tone={confirmed ? "online" : "pending"} variant="text" label={confirmed ? "Confirmed" : "Pending"} />
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
      {dialog}
    </Card>
  );
}

export function ActuatorControl({
  deviceId,
  deviceOnline,
  catalogEntryId,
}: {
  deviceId: string;
  deviceOnline: boolean;
  catalogEntryId: string;
}) {
  const isAdmin = useIsAdmin();
  const { data: rules, isLoading: rulesLoading } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  const { data: catalogEntry, isLoading: catalogLoading } = useApiSWR<CatalogEntryResponse>(
    `/catalog/${catalogEntryId}`,
  );
  // A fallback, not the primary freshness mechanism — useRealtime's
  // command_ack messages revalidate this same key the moment an ack lands.
  const { data: commands, mutate: mutateCommands } = useApiSWR<CommandResponse[]>(
    `/devices/${deviceId}/commands`,
    { refreshInterval: 20_000 },
  );

  // The template's declared actuators are the primary source — a rule
  // referencing an actuator is unioned in too, so a control never disappears
  // for an actuator an active rule still commands even if it was since
  // dropped from the template.
  const actuators = useMemo(() => {
    const set = new Set<string>((catalogEntry?.actuators ?? []).map((a) => a.name));
    for (const rule of rules ?? []) {
      const action = parseAction(rule.action);
      if (action?.type === "actuator_command") set.add(action.actuator);
    }
    return Array.from(set);
  }, [catalogEntry, rules]);

  if (rulesLoading || catalogLoading) return <LoadingSkeleton rows={2} rowClassName="h-24" />;

  // Only known-to-exist actuators are shown — no speculative fixed list
  // (UX_UI_Description.md §3's "only render what's known to exist").
  if (actuators.length === 0) {
    return (
      <EmptyState
        title="No actuators configured"
        description="This device's template doesn't declare any actuators, and no rule commands one yet."
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
