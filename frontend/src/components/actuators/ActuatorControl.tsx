"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useApi } from "@/hooks/useApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ApiRequestError } from "@/lib/api-client";
import { commandStatus, commandStatusLabel, commandStatusTone, msUntilCommandDeadline } from "@/lib/command-status";
import { getDeviceActuators } from "@/lib/device-actuators";
import { timeAgo } from "@/lib/time-ago";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type Value = boolean | number | string;

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}

/** What the control offers: On | Off for an on/off actuator (and for one a
 * rule drives that the template doesn't declare), else its allowed values. */
function choices(def: CatalogActuator | undefined): Value[] {
  if (def && def.value_type !== "bool" && def.allowed_values?.length) return def.allowed_values;
  return [true, false];
}

function ActuatorRow({
  deviceId,
  actuatorId,
  actuatorLabel,
  def,
  deviceOnline,
  deviceDisabled,
  isAdmin,
  latest,
  ruleName,
  onSent,
}: {
  deviceId: string;
  /** The stable wire id — sent to the API and matched against CommandResponse.actuator. */
  actuatorId: string;
  /** The pretty catalog display name shown to the user. */
  actuatorLabel: string;
  def: CatalogActuator | undefined;
  deviceOnline: boolean;
  deviceDisabled: boolean;
  isAdmin: boolean;
  latest: CommandResponse | undefined;
  ruleName: (id: string) => string | undefined;
  /** Re-fetches the device's commands; resolves with the fresh list. */
  onSent: () => Promise<CommandResponse[] | undefined>;
}) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Accepted (202), not yet a command row: the worker writes it a moment later.
  const [sending, setSending] = useState<Value | null>(null);

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
  const options = choices(def);
  const requested: unknown = sending ?? latest?.value;

  async function send(next: Value, retry = false) {
    const words = formatValue(next);
    const verb = typeof next === "boolean" ? `Turn ${words}` : `Set to ${words}`;
    const what = typeof next === "boolean" ? `turn ${actuatorLabel} ${words}` : `set ${actuatorLabel} to ${words}`;
    // DESIGN.md §8: a command to an offline device says so before it's sent.
    const body = deviceOnline
      ? `${retry ? "Send it again: " : ""}${what.charAt(0).toUpperCase()}${what.slice(1)}?`
      : `The device is offline. The command waits as its desired state and applies when it reconnects, if that's within the command's time limit. ${what.charAt(0).toUpperCase()}${what.slice(1)}?`;
    const ok = await confirm(body, {
      title: deviceOnline ? undefined : "Send to an offline device?",
      danger: false,
      confirmLabel: retry ? "Retry" : verb,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const sentAt = Date.now();
      await api.post(`/devices/${deviceId}/commands`, { actuator: actuatorId, value: next });
      // The API accepts it (202) and the worker writes the command row a
      // moment later: say "Sending…" until it shows up, polling briefly.
      setSending(next);
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

  const rule = latest?.rule_id ? ruleName(latest.rule_id) : undefined;

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-soft px-3.5 py-3 text-sm first:border-t-0">
      <div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-0.5">
        <b className="font-medium text-ink">{actuatorLabel}</b>
        <span className="text-[12.5px] text-ink-muted">
          Requested{" "}
          {requested == null ? <span>unknown</span> : <b className="font-medium text-ink">{formatValue(requested)}</b>}
        </span>
        {/* What happened, then who sent it (DESIGN.md §8). "Device reports"
            waits for reported state (§13, deferred). */}
        <span aria-live="polite" className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-muted">
          {sending != null ? (
            <span className="text-status-pending">Sending…</span>
          ) : latest && status ? (
            <>
              {status === "pending" ? (
                <span className="text-status-pending">
                  Waiting for the device… <span className="tabular-nums">{Math.ceil((waitingMs ?? 0) / 1000)}</span> s
                </span>
              ) : status === "no-response" ? (
                <>
                  <span className="text-status-offline">No response within {latest.ttl_seconds} s.</span>
                  {isAdmin && !deviceDisabled && (
                    <Button variant="link" className="text-[12.5px]" disabled={busy} onClick={() => void send(latest.value as Value, true)}>
                      Retry
                    </Button>
                  )}
                </>
              ) : (
                <Badge tone={commandStatusTone(status)} variant="text" label={commandStatusLabel(status)} />
              )}
              <span>
                {" · sent "}
                {latest.rule_id ? (
                  <>
                    by rule{" "}
                    <Link href={`/rules/${latest.rule_id}`} className="text-accent hover:underline">
                      {rule ?? "a rule"}
                    </Link>
                  </>
                ) : (
                  "manually"
                )}
                , {timeAgo(latest.issued_at)}
              </span>
            </>
          ) : (
            <span>Nothing sent yet</span>
          )}
        </span>
        {error && <span className="text-[12.5px] text-status-error">{error}</span>}
      </div>
      {isAdmin && (
        <SegmentedControl
          ariaLabel={`Set ${actuatorLabel}`}
          size="md"
          value={requested == null ? "" : JSON.stringify(requested)}
          onChange={(v) => {
            if (!busy) void send(JSON.parse(v) as Value);
          }}
          options={options.map((o) => ({ value: JSON.stringify(o), label: formatValue(o), disabled: deviceDisabled || busy }))}
        />
      )}
      {dialog}
    </div>
  );
}

/** The device's actuators as Line rows (demo H Controls): what was
 * requested, what happened, who sent it, and an On | Off segmented control
 * whose pressed segment is the requested value. Offline is said once, above
 * the rows, by the page. */
export function ActuatorControl({
  deviceId,
  deviceOnline,
  deviceDisabled = false,
  catalogEntryId,
}: {
  deviceId: string;
  deviceOnline: boolean;
  /** A disabled device can't connect: its controls are off. */
  deviceDisabled?: boolean;
  catalogEntryId: string;
}) {
  const isAdmin = useIsAdmin();
  const { data: rules, isLoading: rulesLoading } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  const { data: allRules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: catalogEntry, isLoading: catalogLoading } = useApiSWR<CatalogEntryResponse>(`/catalog/${catalogEntryId}`);
  // A fallback, not the primary freshness mechanism — useRealtime's
  // command_ack messages revalidate this same key the moment an ack lands.
  const { data: commands, mutate: mutateCommands } = useApiSWR<CommandResponse[]>(`/devices/${deviceId}/commands`, { refreshInterval: 20_000 });

  const actuators = useMemo(() => getDeviceActuators(catalogEntry, rules, deviceId), [catalogEntry, rules, deviceId]);
  const ruleNames = useMemo(() => new Map((allRules ?? []).map((r) => [r.id, r.name])), [allRules]);

  if (rulesLoading || catalogLoading) return <LoadingSkeleton rows={2} rowClassName="h-16" />;

  // Only known-to-exist actuators are shown — no speculative fixed list.
  if (actuators.length === 0) {
    return (
      <EmptyState
        title="No actuators configured"
        description="This device's template doesn't declare any actuators, and no rule commands one yet."
      />
    );
  }

  return (
    <div role="group" aria-label="Actuators" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {actuators.map(({ id, label }) => (
        <ActuatorRow
          key={id}
          deviceId={deviceId}
          actuatorId={id}
          actuatorLabel={label}
          def={catalogEntry?.actuators.find((a) => wireId(a) === id)}
          deviceOnline={deviceOnline}
          deviceDisabled={deviceDisabled}
          isAdmin={isAdmin}
          latest={commands?.find((c) => c.actuator === id)}
          ruleName={(rid) => ruleNames.get(rid)}
          onSent={() => mutateCommands()}
        />
      ))}
    </div>
  );
}
