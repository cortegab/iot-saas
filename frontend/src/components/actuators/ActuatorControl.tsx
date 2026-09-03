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
import { wireId } from "@/lib/wire-id";
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
  onSent: () => void;
}) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentValue = latest?.value ?? false;

  // Re-render once when the pending command crosses its TTL deadline, so the
  // badge flips "Pending" → "No response" on time instead of waiting for the
  // next SWR poll. A late ack landing after this still revalidates the list
  // (useRealtime) and wins, since acked_at takes precedence.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!latest) return;
    const ms = msUntilCommandDeadline(latest);
    if (ms == null) return;
    const id = setTimeout(() => forceTick((n) => n + 1), ms + 250);
    return () => clearTimeout(id);
  }, [latest]);

  const status = latest ? commandStatus(latest) : null;

  async function send(nextValue: boolean) {
    const ok = await confirm(`Turn ${actuatorLabel} ${nextValue ? "ON" : "OFF"}?`, {
      danger: false,
      confirmLabel: nextValue ? "Turn ON" : "Turn OFF",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/devices/${deviceId}/commands`, { actuator: actuatorId, value: nextValue });
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
        <span className="font-medium text-ink">{actuatorLabel}</span>
        {isAdmin && (
          <Button disabled={busy} onClick={() => void send(!(currentValue === true))}>
            Turn {currentValue === true ? "OFF" : "ON"}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm text-ink-muted">
        {latest && status ? (
          <>
            <span>
              Requested <span className="text-ink">{formatValue(latest.value)}</span>
            </span>
            <span aria-hidden>·</span>
            <Badge
              tone={commandStatusTone(status)}
              variant="text"
              label={commandStatusLabel(status)}
            />
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

  // The template's declared actuators are the primary source — an actuator a
  // rule commands *on this device* is unioned in too, so a control never
  // disappears for an actuator an active rule still drives even if it was
  // since dropped from the template. A rule listed here may only use this
  // device as a condition input while its action targets another device — so
  // an `actuator_command` action counts only when its `device_id` is this
  // device (or absent, for pre-multi-device data). `id` is the stable wire id
  // (catalog `key`, or a slugified `name`); `label` is the pretty catalog
  // name — a rule's raw actuator string has no known label, so it's shown
  // as-is.
  const actuators = useMemo(() => {
    const options = new Map<string, string>();
    for (const a of catalogEntry?.actuators ?? []) {
      const id = wireId(a);
      if (!options.has(id)) options.set(id, a.name);
    }
    for (const rule of rules ?? []) {
      for (const raw of rule.actions) {
        if (
          raw.type === "actuator_command" &&
          typeof raw.actuator === "string" &&
          (raw.device_id == null || raw.device_id === deviceId) &&
          !options.has(raw.actuator)
        ) {
          options.set(raw.actuator, raw.actuator);
        }
      }
    }
    return Array.from(options, ([id, label]) => ({ id, label }));
  }, [catalogEntry, rules, deviceId]);

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
          onSent={() => void mutateCommands()}
        />
      ))}
    </div>
  );
}
