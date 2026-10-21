"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  commandStatus,
  commandStatusLabel,
  commandStatusTone,
  msUntilCommandDeadline,
} from "@/lib/command-status";
import { getDeviceActuators } from "@/lib/device-actuators";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}

function ActuatorRow({
  deviceId,
  actuatorId,
  actuatorLabel,
  deviceOnline,
  isAdmin,
  latest,
  onSent,
}: {
  deviceId: string;
  /** The stable wire id — sent to the API and matched against CommandResponse.actuator. */
  actuatorId: string;
  /** The pretty catalog display name shown to the user. */
  actuatorLabel: string;
  deviceOnline: boolean;
  isAdmin: boolean;
  latest: CommandResponse | undefined;
  /** Re-fetches the device's commands; resolves with the fresh list. */
  onSent: () => Promise<CommandResponse[] | undefined>;
}) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Accepted (202), not yet a command row: the worker writes it a moment later.
  const [sending, setSending] = useState<boolean | null>(null);

  const currentValue = latest?.value ?? false;

  // While a command waits, tick every second: the countdown (DESIGN.md §8)
  // runs live, and "Waiting" flips to "No response" at the TTL deadline
  // instead of at the next SWR poll. A late ack still revalidates the list
  // (useRealtime) and wins, since acked_at takes precedence.
  const [, forceTick] = useState(0);
  const waitingMs = latest ? msUntilCommandDeadline(latest) : null;
  useEffect(() => {
    if (waitingMs == null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [waitingMs == null, latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = latest ? commandStatus(latest) : null;

  async function send(nextValue: boolean, retry = false) {
    const words = nextValue ? "On" : "Off";
    // DESIGN.md §8: a command to an offline device says so before it's sent.
    const body = deviceOnline
      ? `${retry ? "Send it again: turn" : "Turn"} ${actuatorLabel} ${words}?`
      : `The device is offline. The command waits as its desired state and applies when it reconnects, if that's within the command's time limit. Turn ${actuatorLabel} ${words}?`;
    const ok = await confirm(body, {
      title: deviceOnline ? undefined : "Send to an offline device?",
      danger: false,
      confirmLabel: retry ? "Retry" : `Turn ${words}`,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const sentAt = Date.now();
      await api.post(`/devices/${deviceId}/commands`, { actuator: actuatorId, value: nextValue });
      // The API accepts it (202) and the worker writes the command row a
      // moment later: say "Sending…" until it shows up, polling briefly.
      setSending(nextValue);
      for (let i = 0; i < 15; i++) {
        const list = await onSent();
        if (list?.some((c) => c.actuator === actuatorId && new Date(c.issued_at).getTime() >= sentAt - 2000)) break;
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send this command.");
    } finally {
      setSending(null);
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink">{actuatorLabel}</span>
        {isAdmin && (
          <Button disabled={busy} onClick={() => void send(!(currentValue === true))}>
            Turn {currentValue === true ? "Off" : "On"}
          </Button>
        )}
      </div>

      {/* Requested, then what happened (DESIGN.md §8). "Device reports"
          waits for reported state (§13, deferred). */}
      <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        {sending != null ? (
          <>
            <span>
              Requested <span className="text-ink">{formatValue(sending)}</span>
            </span>
            <span aria-hidden>·</span>
            <span className="text-status-pending">Sending…</span>
          </>
        ) : latest && status ? (
          <>
            <span>
              Requested <span className="text-ink">{formatValue(latest.value)}</span>
            </span>
            <span aria-hidden>·</span>
            {status === "pending" ? (
              <span className="text-status-pending">
                Waiting for the device… <span className="tabular-nums">{Math.ceil((waitingMs ?? 0) / 1000)}</span> s
              </span>
            ) : status === "no-response" ? (
              <>
                <span className="text-status-offline">No response within {latest.ttl_seconds} s.</span>
                {isAdmin && typeof latest.value === "boolean" && (
                  <Button variant="link" className="text-sm" disabled={busy} onClick={() => void send(latest.value as boolean, true)}>
                    Retry
                  </Button>
                )}
              </>
            ) : (
              <Badge tone={commandStatusTone(status)} variant="text" label={commandStatusLabel(status)} />
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

  const actuators = useMemo(
    () => getDeviceActuators(catalogEntry, rules, deviceId),
    [catalogEntry, rules, deviceId],
  );

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
      {actuators.map(({ id, label }) => (
        <ActuatorRow
          key={id}
          deviceId={deviceId}
          actuatorId={id}
          actuatorLabel={label}
          deviceOnline={deviceOnline}
          isAdmin={isAdmin}
          latest={commands?.find((c) => c.actuator === id)}
          onSent={() => mutateCommands()}
        />
      ))}
    </div>
  );
}
