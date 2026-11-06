import { commandRange, controlKind, isRequested, parseCommand, type CommandRange, type CommandValue } from "@iodriven/shared/actuator-command";
import type { components } from "@iodriven/shared/api";
import { ApiRequestError } from "@iodriven/shared/api-client";
import { commandStatus, msUntilCommandDeadline } from "@iodriven/shared/command-status";
import { getDeviceActuators } from "@iodriven/shared/device-actuators";
import { timeAgo } from "@iodriven/shared/time-ago";
import { wireId } from "@iodriven/shared/wire-id";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useCan } from "@/hooks/useCan";
import { font, radius, text as textScale, touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Switch } from "@/ui/Switch";
import { Text } from "@/ui/Text";

type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

export function formatCommandValue(value: unknown, unit?: string): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return typeof value === "number" && unit ? `${value}${unit === "°" ? "" : " "}${unit}` : String(value);
}

/** The web's confirm (DESIGN.md §8) as a native dialog: true when confirmed. */
function confirm(title: string, body: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      title,
      body,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: action, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

/** A number or text actuator: type a value, Set sends it. Set waits while the
 * box holds the value already requested. */
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
  const theme = useTheme();
  const shown = requested == null || typeof requested === "boolean" ? "" : String(requested);
  // What's typed, or null to show the requested value (refilled when a new
  // request lands, unless someone is typing).
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? shown;
  const parsed = parseCommand(value, kind, range);
  const error = typed != null && "error" in parsed ? parsed.error : null;
  const same = "value" in parsed && isRequested(parsed.value, requested);

  function submit() {
    if (!("value" in parsed) || same || disabled) return;
    setTyped(null);
    onSet(parsed.value);
  }

  return (
    <View style={styles.valueField}>
      <View style={styles.valueRow}>
        <View style={[styles.input, { backgroundColor: theme.input, borderColor: error ? theme.statusError : theme.border }]}>
          <TextInput
            accessibilityLabel={label}
            value={value}
            onChangeText={setTyped}
            editable={!disabled}
            keyboardType={kind === "number" ? "decimal-pad" : "default"}
            returnKeyType="done"
            onSubmitEditing={submit}
            style={[styles.inputText, { color: theme.ink, fontFamily: font.regular }]}
          />
          {range?.unit ? <Text color="inkMuted">{range.unit}</Text> : null}
        </View>
        <Button label="Set" variant="secondary" onPress={submit} disabled={disabled || same || "error" in parsed} />
      </View>
      <Text size="micro" color={error ? "statusError" : "inkMuted"}>
        {error ?? (range ? `${range.min}–${range.max}${range.unit ?? ""}` : " ")}
      </Text>
    </View>
  );
}

function ActuatorRow({
  device,
  actuatorId,
  label,
  def,
  range,
  canSend,
  latest,
  ruleName,
  onSent,
}: {
  device: DeviceResponse;
  actuatorId: string;
  label: string;
  def: CatalogActuator | undefined;
  range: CommandRange | null;
  canSend: boolean;
  latest: CommandResponse | undefined;
  ruleName: (id: string) => string | undefined;
  onSent: () => Promise<CommandResponse[] | undefined>;
}) {
  const theme = useTheme();
  const api = useApi();
  const online = device.connection_state === "online";
  const disabled = device.status !== "active";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Accepted (202), not yet a command row: the worker writes it a moment later.
  const [sending, setSending] = useState<CommandValue | null>(null);

  // While a command waits, tick every second: the countdown runs live and
  // flips to No response at the deadline.
  const [now, setNow] = useState(() => Date.now());
  const waiting = latest ? msUntilCommandDeadline(latest, now) != null : false;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting, latest?.id]);

  const status = latest ? commandStatus(latest, now) : null;
  const waitingMs = latest ? msUntilCommandDeadline(latest, now) : null;
  const kind = controlKind(def);
  const requested: unknown = sending ?? latest?.value;

  async function send(next: CommandValue, retry = false) {
    // The value already requested isn't sent again; Retry is the only resend.
    if (!retry && isRequested(next, requested)) return;
    const words = formatCommandValue(next, range?.unit);
    const verb = typeof next === "boolean" ? `Turn ${words}` : `Set to ${words}`;
    const what = typeof next === "boolean" ? `Turn ${label} ${words}?` : `Set ${label} to ${words}?`;
    const ok = online
      ? await confirm(retry ? "Send it again?" : what, retry ? what : "", retry ? "Retry" : verb)
      : await confirm(
          "Send to an offline device?",
          `The device is offline. The command waits as its desired state and applies when it reconnects, if that's within the command's time limit. ${what}`,
          retry ? "Retry" : verb,
        );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const sentAt = Date.now();
      await api.post(`/devices/${device.id}/commands`, { actuator: actuatorId, value: next });
      setSending(next);
      for (let i = 0; i < 15; i++) {
        const list = await onSent();
        if (list?.some((c) => c.actuator === actuatorId && new Date(c.issued_at).getTime() >= sentAt - 2000)) break;
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send this command. Check your connection and try again.");
    } finally {
      setSending(null);
      setBusy(false);
      setNow(Date.now());
    }
  }

  const sentBy = latest ? (latest.rule_id ? `by rule ${ruleName(latest.rule_id) ?? "a rule"}` : "manually") : "";
  const control = !canSend ? null : kind === "switch" ? (
    <Switch accessibilityLabel={label} value={requested === true} disabled={disabled || busy} onValueChange={(on) => void send(on)} />
  ) : null;

  return (
    <View style={[styles.row, { borderTopColor: theme.borderSoft }]}>
      <View style={styles.head}>
        <View style={styles.text}>
          <Text weight="medium">{label}</Text>
          <Text size="meta" color="inkMuted">
            Requested <Text size="meta" weight="medium">{requested == null ? "unknown" : formatCommandValue(requested, range?.unit)}</Text>
          </Text>
          <Text size="meta" color="inkMuted" accessibilityLiveRegion="polite">
            {sending != null ? (
              <Text size="meta" color="statusPending">
                Sending…
              </Text>
            ) : latest && status ? (
              <>
                {status === "pending" ? (
                  <Text size="meta" color="statusPending">
                    Waiting for the device… {Math.ceil((waitingMs ?? 0) / 1000)} s
                  </Text>
                ) : status === "no-response" ? (
                  <Text size="meta" color="statusOffline">
                    No response within {latest.ttl_seconds} s
                  </Text>
                ) : (
                  <Text size="meta" color="statusOnline">
                    Acknowledged
                  </Text>
                )}
                {` · sent ${sentBy}, ${timeAgo(latest.issued_at)}`}
              </>
            ) : (
              "Nothing sent yet"
            )}
          </Text>
        </View>
        {control}
      </View>
      {canSend && kind === "choices" && (
        <Segmented
          accessibilityLabel={`Set ${label}`}
          options={(def?.allowed_values ?? []).map((o) => ({ value: JSON.stringify(o), label: formatCommandValue(o, range?.unit) }))}
          value={requested == null ? "" : JSON.stringify(requested)}
          onChange={(v) => {
            if (!busy && !disabled) void send(JSON.parse(v) as CommandValue);
          }}
        />
      )}
      {canSend && (kind === "number" || kind === "text") && (
        <ValueField label={`Set ${label}`} kind={kind} range={range} requested={requested} disabled={disabled || busy} onSet={(v) => void send(v)} />
      )}
      {canSend && status === "no-response" && latest && !disabled && (
        <Button label="Retry" variant="secondary" busy={busy} onPress={() => void send(latest.value as CommandValue, true)} />
      )}
      {error && (
        <Text size="meta" color="statusError">
          {error}
        </Text>
      )}
    </View>
  );
}

/** A device's actuators (the web's Controls): what was requested, what
 * happened and who sent it, and, for Admins, the control that sends a new
 * value: a Switch for On / Off, segments for a fixed list, a value and Set for
 * a number or text. Offline is said once, above the rows. */
export function ActuatorControl({ device }: { device: DeviceResponse }) {
  const canSend = useCan("commands.send");
  const { data: rules } = useApiSWR<RuleResponse[]>(`/devices/${device.id}/rules`);
  const { data: allRules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: template } = useApiSWR<CatalogEntryResponse>(`/catalog/${device.catalog_entry_id}`);
  // Realtime command_ack revalidates this key the moment an ack lands; the
  // interval is the fallback.
  const { data: commands, mutate } = useApiSWR<CommandResponse[]>(`/devices/${device.id}/commands`, { refreshInterval: 20_000 });

  const actuators = useMemo(() => getDeviceActuators(template, rules, device.id), [template, rules, device.id]);
  const ruleNames = useMemo(() => new Map((allRules ?? []).map((r) => [r.id, r.name])), [allRules]);
  const online = device.connection_state === "online";

  if (!template || !rules) {
    return (
      <Text size="meta" color="inkMuted">
        Loading…
      </Text>
    );
  }
  if (actuators.length === 0) {
    return (
      <Text size="meta" color="inkMuted">
        No actuators: the template declares none, and no rule commands one.
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {!online && device.status === "active" && (
        <Text size="meta" color="statusPending">
          Offline. Commands wait in its desired state and apply when it reconnects.
        </Text>
      )}
      {device.status !== "active" && (
        <Text size="meta" color="inkMuted">
          This device is disabled, so it can&apos;t take commands.
        </Text>
      )}
      {!canSend && (
        <Text size="meta" color="inkMuted">
          Viewers see what was requested; Admins send commands.
        </Text>
      )}
      {actuators.map(({ id, label }) => (
        <ActuatorRow
          key={id}
          device={device}
          actuatorId={id}
          label={label}
          def={template.actuators.find((a) => wireId(a) === id)}
          range={commandRange(device.hardware ?? template.hardware, id)}
          canSend={canSend}
          latest={commands?.find((c) => c.actuator === id)}
          ruleName={(rid) => ruleNames.get(rid)}
          onSent={() => mutate()}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 4 },
  row: { gap: 10, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1, gap: 2 },
  valueField: { gap: 4 },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    minHeight: touchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inputText: { flex: 1, fontSize: textScale.sm.fontSize, paddingVertical: 8 },
});
