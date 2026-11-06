/** A dashboard's widgets in native form (the web's components/dashboards/*
 * widgets): the same five types, the same rule that a stale value is never
 * shown as current, stacked one per row on a phone (DESIGN.md §8). */
import type { components } from "@iodriven/shared/api";
import { DEVICE_STATUS, deviceStatusKey } from "@iodriven/shared/device-status";
import { formatReading, isBoolMetric } from "@iodriven/shared/format-reading";
import { timeAgo } from "@iodriven/shared/time-ago";
import { wireId } from "@iodriven/shared/wire-id";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import { DeviceTrend } from "@/chart/DeviceTrend";
import { useApiSWR } from "@/hooks/useApiSWR";
import { webUrl } from "@/lib/config";
import { font, radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

type Widget = components["schemas"]["Widget"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];

/** The device a widget reads and its template's definition of the metric.
 * The SWR keys are the device screen's, so live updates reach both. */
function useWidgetDevice(deviceId: string, metric?: string | null) {
  const { data: device } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`, { refreshInterval: 20_000 });
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const meta = metric ? template?.metrics.find((m) => wireId(m) === metric) : undefined;
  return { device, template, meta, stale: device != null && device.connection_state !== "online" };
}

function useLatest(deviceId: string, metric?: string | null) {
  const { data } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, { refreshInterval: 20_000 });
  return data?.find((r) => r.metric === metric);
}

/** A widget's frame: its title, the device it reads (opens the device), the
 * body. */
function WidgetCard({ title, device, children }: { title: string; device?: DeviceResponse; children: ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <Text weight="medium" numberOfLines={1} style={styles.flex}>
          {title}
        </Text>
        {device ? (
          <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push(`/devices/${device.id}`)}>
            <Text size="meta" color="accent" numberOfLines={1}>
              {device.name}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** When the value arrived, or "Stale · last value X ago" in the warning tone
 * once the device is offline. */
function Foot({ stale, time }: { stale: boolean; time?: string | null }) {
  const theme = useTheme();
  if (!stale) {
    return (
      <Text size="micro" color="inkMuted">
        {time ? timeAgo(time) : "live"}
      </Text>
    );
  }
  return (
    <View style={styles.row}>
      <AlertTriangle size={12} color={theme.statusPending} />
      <Text size="micro" color="statusPending">
        Stale · last value{time ? ` ${timeAgo(time)}` : ""}
      </Text>
    </View>
  );
}

function ValueCard({ w }: { w: Widget }) {
  const { device, meta, stale } = useWidgetDevice(w.device_id, w.metric);
  const reading = useLatest(w.device_id, w.metric);
  const value = reading ? formatReading(reading.value, meta) : "—";
  return (
    <WidgetCard title={meta?.name ?? w.metric ?? "Value"} device={device}>
      <View style={styles.valueRow}>
        <Text size="title" weight="semibold" color={stale && reading ? "inkMuted" : "ink"} style={styles.tabular}>
          {value}
        </Text>
        {reading && meta?.unit && !isBoolMetric(meta) ? <Text color="inkMuted">{meta.unit}</Text> : null}
      </View>
      {reading ? <Foot stale={stale} time={reading.time} /> : <Text size="micro" color="inkMuted">No data</Text>}
    </WidgetCard>
  );
}

// The web's semicircular gauge: one arc through the top, the value as a
// dash along it, min and max under the ends.
const ARC = "M12 62 A48 48 0 0 1 108 62";
const ARC_LENGTH = Math.PI * 48;

function Gauge({ w }: { w: Widget }) {
  const theme = useTheme();
  const { device, meta, stale } = useWidgetDevice(w.device_id, w.metric);
  const reading = useLatest(w.device_id, w.metric);
  const lo = w.min ?? meta?.min ?? 0;
  const hi = w.max ?? meta?.max ?? 100;
  const fraction = reading && hi > lo ? Math.min(1, Math.max(0, (reading.value - lo) / (hi - lo))) : 0;
  const shown = reading ? formatReading(reading.value, meta) : "—";
  return (
    <WidgetCard title={meta?.name ?? w.metric ?? "Gauge"} device={device}>
      <View accessible accessibilityLabel={`${shown} ${meta?.unit ?? ""} on a ${lo} to ${hi} scale`} style={styles.gauge}>
        <Svg viewBox="0 0 120 66" width="100%" height={110}>
          <Path d={ARC} fill="none" stroke={theme.surfaceRaised} strokeWidth={10} strokeLinecap="round" />
          {reading ? (
            <Path
              d={ARC}
              fill="none"
              stroke={theme.chart}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={`${(fraction * ARC_LENGTH).toFixed(1)} ${ARC_LENGTH.toFixed(1)}`}
            />
          ) : null}
          <SvgText x="60" y="58" textAnchor="middle" fill={stale && reading ? theme.inkMuted : theme.ink} fontFamily={font.semibold} fontSize={18}>
            {shown}
            {reading && meta?.unit ? ` ${meta.unit}` : ""}
          </SvgText>
        </Svg>
        <View style={styles.scale}>
          <Text size="micro" color="inkMuted">
            {lo}
          </Text>
          <Text size="micro" color="inkMuted">
            {hi}
          </Text>
        </View>
      </View>
      {reading ? <Foot stale={stale} time={reading.time} /> : <Text size="micro" color="inkMuted">No data</Text>}
    </WidgetCard>
  );
}

function Trend({ w, rangeMs }: { w: Widget; rangeMs: number }) {
  const { device, meta } = useWidgetDevice(w.device_id, w.metric);
  if (!w.metric) return null;
  return (
    <WidgetCard title={meta?.name ?? w.metric} device={device}>
      <DeviceTrend deviceId={w.device_id} metricKey={w.metric} meta={meta} rangeMs={rangeMs} />
    </WidgetCard>
  );
}

function DeviceStatus({ w }: { w: Widget }) {
  const { device } = useWidgetDevice(w.device_id);
  const s = device ? DEVICE_STATUS[deviceStatusKey(device)] : null;
  const facts = device
    ? [device.rssi != null ? `${device.rssi} dBm` : null, device.battery_pct != null ? `${device.battery_pct}% battery` : null, device.fw_version ? `firmware ${device.fw_version}` : null].filter(Boolean)
    : [];
  return (
    <WidgetCard title="Status" device={device}>
      {device && s ? (
        <>
          <View style={styles.row}>
            <StatusDot tone={s.tone} shape={s.shape} />
            <Text weight="medium">{s.label}</Text>
          </View>
          <Text size="meta" color="inkMuted">
            {device.last_seen_at ? `Last message ${timeAgo(device.last_seen_at)}` : "Waiting for its first message"}
          </Text>
          {facts.length ? (
            <Text size="micro" color="inkMuted">
              {facts.join(" · ")}
            </Text>
          ) : null}
        </>
      ) : (
        <Text size="meta" color="inkMuted">
          Loading…
        </Text>
      )}
    </WidgetCard>
  );
}

const commandWords = (v: unknown) => (typeof v === "boolean" ? (v ? "On" : "Off") : String(v));

/** Read-only in this version: what each actuator was last asked to do. */
function Actuators({ w }: { w: Widget }) {
  const theme = useTheme();
  const { device, template } = useWidgetDevice(w.device_id);
  const { data: commands } = useApiSWR<CommandResponse[]>(`/devices/${w.device_id}/commands`, { refreshInterval: 20_000 });
  const actuators = template?.actuators ?? [];
  return (
    <WidgetCard title="Controls" device={device}>
      {actuators.length === 0 ? (
        <Text size="meta" color="inkMuted">
          No actuators on this device.
        </Text>
      ) : (
        actuators.map((a) => {
          const latest = commands?.find((c) => c.actuator === wireId(a));
          return (
            <View key={wireId(a)} style={[styles.actuator, { borderTopColor: theme.borderSoft }]}>
              <Text weight="medium" style={styles.flex}>
                {a.name}
              </Text>
              <Text size="meta" color="inkMuted">
                {latest ? `Requested ${commandWords(latest.value)}${latest.acked_at ? " · Acknowledged" : ""}` : "Nothing sent yet"}
              </Text>
            </View>
          );
        })
      )}
      {device ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${webUrl()}/devices/${device.id}?tab=controls`)}>
          <Text size="meta" color="accent">
            Switch on the web
          </Text>
        </Pressable>
      ) : null}
    </WidgetCard>
  );
}

export function DashboardWidget({ w, rangeMs }: { w: Widget; rangeMs: number }) {
  switch (w.type) {
    case "value_card":
      return <ValueCard w={w} />;
    case "gauge":
      return <Gauge w={w} />;
    case "trend_chart":
      return <Trend w={w} rangeMs={rangeMs} />;
    case "device_status":
      return <DeviceStatus w={w} />;
    case "actuator_control":
      return <Actuators w={w} />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: 14, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  tabular: { fontVariant: ["tabular-nums"] },
  gauge: { alignItems: "center" },
  scale: { flexDirection: "row", justifyContent: "space-between", width: "100%", maxWidth: 220 },
  actuator: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
