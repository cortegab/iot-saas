"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useApi } from "@/hooks/useApi";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Affix, Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { commandRange, controlKind, isRequested, parseCommand, type CommandRange, type CommandValue } from "@/lib/actuator-command";
import { ApiRequestError } from "@/lib/api-client";
import { commandStatus, commandStatusLabel, commandStatusTone, lastConfirmedValue, manualSender, msUntilCommandDeadline } from "@/lib/command-status";
import { getDeviceActuators, rulesDrivingActuator } from "@/lib/device-actuators";
import { timeAgo } from "@/lib/time-ago";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type HardwareConfig = components["schemas"]["HardwareConfig"];
type MemberResponse = components["schemas"]["MemberResponse"];

function formatValue(value: unknown, unit?: string): string {
  if (typeof value === "boolean") return value ? t("actuator.on") : t("actuator.off");
  return typeof value === "number" && unit ? `${value}${unit === "°" ? "" : " "}${unit}` : String(value);
}

/** A number or text actuator: type a value, Set sends it. Set waits while the
 * box holds the value already requested (DESIGN.md §8). */
function ValueField({
  label,
  kind,
  range,
  requested,
  disabled,
  onSet,
}: {
  label: string;
  kind: "number" | "text";
  range: CommandRange | null;
  requested: unknown;
  disabled: boolean;
  onSet: (value: CommandValue) => void;
}) {
  const hintId = useId();
  const shown = requested == null || typeof requested === "boolean" ? "" : String(requested);
  const [text, setText] = useState(shown);
  const [touched, setTouched] = useState(false);
  // A new request (from a rule, another person, or this Set) refills the box
  // unless someone is typing in it.
  useEffect(() => {
    if (!touched) setText(shown);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseCommand(text, kind, range);
  const error = touched && "error" in parsed ? parsed.error : null;
  const same = "value" in parsed && isRequested(parsed.value, requested);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!("value" in parsed) || same || disabled) return;
    setTouched(false);
    onSet(parsed.value);
  }

  const input = (
    <Input
      aria-label={label}
      aria-describedby={hintId}
      aria-invalid={error ? true : undefined}
      inputMode={kind === "number" ? "decimal" : undefined}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        setTouched(true);
      }}
      className={kind === "number" ? "w-24 tabular-nums" : "w-40"}
    />
  );
  return (
    <form onSubmit={submit} noValidate className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {range?.unit ? <Affix suffix={range.unit}>{input}</Affix> : input}
        <Button type="submit" variant="secondary" disabled={disabled || same || "error" in parsed}>
          {t("actuator.set")}
        </Button>
      </div>
      <span id={hintId} className={error ? "text-xs text-status-error" : "text-xs text-ink-muted tabular-nums"}>
        {error ?? (range ? `${range.min}–${range.max}${range.unit ?? ""}` : null)}
      </span>
    </form>
  );
}

function ActuatorRow({
  deviceId,
  actuatorId,
  actuatorLabel,
  def,
  range,
  deviceOnline,
  deviceDisabled,
  isAdmin,
  latest,
  confirmed,
  drivingRules,
  sender,
  ruleName,
  onSent,
  automateHref,
}: {
  deviceId: string;
  /** The stable wire id — sent to the API and matched against CommandResponse.actuator. */
  actuatorId: string;
  /** The pretty catalog display name shown to the user. */
  actuatorLabel: string;
  def: CatalogActuator | undefined;
  /** A number actuator's span, from its wiring. */
  range: CommandRange | null;
  deviceOnline: boolean;
  deviceDisabled: boolean;
  isAdmin: boolean;
  latest: CommandResponse | undefined;
  /** The value the device last confirmed (its newest acknowledged command). */
  confirmed: unknown;
  /** Enabled rules that also switch this actuator. */
  drivingRules: string[];
  /** "by you", "by Ana" or "manually", for a manual command. */
  sender: (c: CommandResponse) => string;
  ruleName: (id: string) => string | undefined;
  /** Re-fetches the device's commands; resolves with the fresh list. */
  onSent: () => Promise<CommandResponse[] | undefined>;
  automateHref?: string;
}) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Accepted (202), not yet a command row: the worker writes it a moment later.
  const [sending, setSending] = useState<CommandValue | null>(null);

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
  const kind = controlKind(def);
  const requested: unknown = sending ?? latest?.value;
  const unconfirmed = sending == null && latest != null && status !== "confirmed";

  async function send(next: CommandValue, retry = false) {
    // The value already requested isn't sent again; Retry is the only resend.
    if (!retry && isRequested(next, requested)) return;
    const words = formatValue(next, range?.unit);
    const verb = typeof next === "boolean" ? t(next ? "actuator.verbOn" : "actuator.verbOff") : t("actuator.setTo", { value: words });
    // DESIGN.md §8: a command to an offline device says so before it's sent.
    const ask =
      typeof next === "boolean" ? t(next ? "actuator.askOn" : "actuator.askOff", { name: actuatorLabel }) : t("actuator.askSet", { name: actuatorLabel, value: words });
    // A rule that also switches it may switch it straight back: say which.
    const rulesNote =
      drivingRules.length > 0
        ? ` ${t(drivingRules.length === 1 ? "actuator.alsoOne" : "actuator.alsoMany", { rules: drivingRules.join(", ") })}`
        : "";
    const body = deviceOnline
      ? `${retry ? t("actuator.sendAgain", { ask }) : ask}${rulesNote}`
      : `${t("actuator.offlineBody")}${rulesNote} ${ask}`;
    const ok = await confirm(body, {
      title: deviceOnline ? undefined : t("actuator.offlineTitle"),
      danger: false,
      confirmLabel: retry ? t("actuator.retry") : verb,
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
      setError(err instanceof ApiRequestError ? err.message : t("actuator.sendFailed"));
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
        <span className="text-xs text-ink-muted">
          {t("actuator.requested")}{" "}
          {requested == null ? <span>{t("actuator.unknown")}</span> : <b className="font-medium text-ink">{formatValue(requested, range?.unit)}</b>}
          {/* The control shows what was asked; until the device confirms it,
              say what it last confirmed, so a switch reading Off over a pump
              that never got the command doesn't pass for the truth. */}
          {unconfirmed && (
            <span className="text-status-pending">
              {t("actuator.notConfirmed")}
              {confirmed !== undefined && !isRequested(confirmed as CommandValue, requested) && t("actuator.lastConfirmed", { value: formatValue(confirmed, range?.unit) })}
            </span>
          )}
        </span>
        {/* What happened, then who sent it (DESIGN.md §8). "Device reports"
            waits for reported state (§13, deferred). */}
        <span aria-live="polite" className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
          {sending != null ? (
            <span className="text-status-pending">{t("actuator.sending")}</span>
          ) : latest && status ? (
            <>
              {status === "pending" ? (
                <span className="text-status-pending">
                  <span className="tabular-nums">{t("actuator.waiting", { n: String(Math.ceil((waitingMs ?? 0) / 1000)) })}</span>
                </span>
              ) : status === "no-response" ? (
                <>
                  <span className="text-status-offline">{t("actuator.noResponse", { n: String(latest.ttl_seconds) })}</span>
                  {isAdmin && !deviceDisabled && (
                    <Button variant="link" className="text-xs" disabled={busy} onClick={() => void send(latest.value as CommandValue, true)}>
                      {t("actuator.retry")}
                    </Button>
                  )}
                </>
              ) : (
                <Badge tone={commandStatusTone(status)} variant="text" label={commandStatusLabel(status)} />
              )}
              <span>
                {latest.rule_id ? (
                  <>
                    {t("actuator.sentByRule")}{" "}
                    <Link href={`/rules/${latest.rule_id}`} className="link-inline">
                      {rule ?? t("actuator.aRule")}
                    </Link>
                  </>
                ) : (
                  t("actuator.sentBy", { who: sender(latest) })
                )}
                , {timeAgo(latest.issued_at)}
              </span>
            </>
          ) : (
            <span>{t("actuator.nothingSent")}</span>
          )}
        </span>
        {error && <span className="text-xs text-status-error">{error}</span>}
        {automateHref && kind === "switch" && (
          <Link href={automateHref} className="link-inline w-fit text-xs" aria-label={t("actuator.automateLabel", { name: actuatorLabel })}>
            {t("actuator.automate")}
          </Link>
        )}
      </div>
      {isAdmin &&
        (kind === "switch" ? (
          <Switch
            ariaLabel={actuatorLabel}
            checked={requested === true}
            disabled={deviceDisabled || busy}
            onChange={(on) => void send(on)}
          />
        ) : kind === "choices" ? (
          <SegmentedControl
            ariaLabel={`Set ${actuatorLabel}`}
            size="md"
            value={requested == null ? "" : JSON.stringify(requested)}
            onChange={(v) => {
              if (!busy) void send(JSON.parse(v) as CommandValue);
            }}
            options={(def?.allowed_values ?? []).map((o) => ({ value: JSON.stringify(o), label: formatValue(o, range?.unit), disabled: deviceDisabled || busy }))}
          />
        ) : (
          <ValueField
            label={`Set ${actuatorLabel}`}
            kind={kind}
            range={range}
            requested={requested}
            disabled={deviceDisabled || busy}
            onSet={(v) => void send(v)}
          />
        ))}
      {dialog}
    </div>
  );
}

/** The device's actuators as Line rows (demo H Controls): what was
 * requested, what happened, who sent it, and the control that sends a new
 * value: a Switch for On / Off, a segmented control for a fixed list, a value
 * and Set for a number or text. Offline is said once, above the rows, by the
 * page. */
export function ActuatorControl({
  deviceId,
  deviceOnline,
  deviceDisabled = false,
  catalogEntryId,
  wiring,
  automateHref,
  only,
}: {
  deviceId: string;
  deviceOnline: boolean;
  /** An on/off output's "Automate…" link (device page; ease-of-use B2). */
  automateHref?: (actuatorId: string) => string | undefined;
  /** Just this actuator (a device tile shows its first on/off output). */
  only?: string;
  /** A disabled device can't connect: its controls are off. */
  deviceDisabled?: boolean;
  catalogEntryId: string;
  /** The device's own wiring; its template's when unset. */
  wiring?: HardwareConfig | null;
}) {
  const isAdmin = useIsAdmin();
  const { data: me } = useCurrentUser();
  const { data: members } = useApiSWR<MemberResponse[]>("/tenants/members");
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
        title={t("actuator.noneTitle")}
        description={t("actuator.noneBody")}
      />
    );
  }

  return (
    // In a tile (`only`) the tile is already the card: no second border.
    <div role="group" aria-label={t("actuator.group")} className={only ? "-mx-3.5 -mb-3.5 flex flex-col border-t border-border-soft" : "flex flex-col overflow-hidden rounded-xl border border-border bg-surface"}>
      {(only ? actuators.filter((a) => a.id === only) : actuators).map(({ id, label }) => (
        <ActuatorRow
          key={id}
          deviceId={deviceId}
          actuatorId={id}
          actuatorLabel={label}
          def={catalogEntry?.actuators.find((a) => wireId(a) === id)}
          range={commandRange(wiring ?? catalogEntry?.hardware, id)}
          deviceOnline={deviceOnline}
          deviceDisabled={deviceDisabled}
          isAdmin={isAdmin}
          latest={commands?.find((c) => c.actuator === id)}
          confirmed={lastConfirmedValue(commands, id)}
          drivingRules={rulesDrivingActuator(allRules, deviceId, id)}
          sender={(c) => manualSender(c, members, me?.id)}
          ruleName={(rid) => ruleNames.get(rid)}
          onSent={() => mutateCommands()}
          automateHref={automateHref?.(id)}
        />
      ))}
    </div>
  );
}
