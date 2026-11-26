import type { components } from "@iodriven/shared/api";
import { DEVICE_STATUS, deviceStatusKey } from "@iodriven/shared/device-status";
import { formatReading } from "@iodriven/shared/format-reading";
import { readingFreshness, type Freshness } from "@iodriven/shared/freshness";
import { timeAgo } from "@iodriven/shared/time-ago";
import { wireId } from "@iodriven/shared/wire-id";
import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams } from "expo-router";
import { ExternalLink } from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { ActuatorControl } from "@/actuators/ActuatorControl";
import { DeviceTrend } from "@/chart/DeviceTrend";
import { useApiSWR } from "@/hooks/useApiSWR";
import { webUrl } from "@/lib/config";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Lines, Row } from "@/ui/Row";
import { Chips } from "@/ui/Chips";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";
import { signalLabel } from "@iodriven/shared/signal";
import { healthKey, healthLabel } from "@iodriven/shared/device-health";
import { capital, words } from "@iodriven/shared/simple-words";
import { AlertSettings } from "@/devices/AlertSettings";
import { useCan } from "@/hooks/useCan";
import { useInterfaceMode } from "@/hooks/useInterfaceMode";
import { tActive as t } from "@iodriven/shared/i18n";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

const FRESHNESS: Record<Freshness, { label: string; tone: "online" | "unknown" }> = {
  live: { get label() { return t("devices.live"); }, tone: "online" },
  stale: { get label() { return t("devices.stale"); }, tone: "unknown" },
  none: { get label() { return t("app.screens.noData"); }, tone: "unknown" },
};

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/** One device (the web's device Overview on a phone): its status, its
 * readings marked Live or Stale, the selected reading's trend, and its
 * health. Editing stays on the web. */
// Why the chip last restarted, as the firmware reports it (firmware/src/diag.h);
// the same words as the web's Health card.
const RESTART_REASON: Record<string, string> = {
  get power_on() { return t("devices.restart.power_on"); },
  get reset_pin() { return t("devices.restart.reset_pin"); },
  get software() { return t("devices.restart.software"); },
  get crash() { return t("devices.restart.crash"); },
  get task_wdt() { return t("devices.restart.task_wdt"); },
  get interrupt_wdt() { return t("devices.restart.interrupt_wdt"); },
  get other_wdt() { return t("devices.restart.other_wdt"); },
  get brownout() { return t("devices.restart.brownout"); },
  get deep_sleep() { return t("devices.restart.deep_sleep"); },
};

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

export default function DeviceScreen() {
  const theme = useTheme();
  const { deviceId } = useLocalSearchParams<{ deviceId: string }>();
  const { data: device, error, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`, { refreshInterval: 30_000 });
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  const { data: latest, mutate: mutateLatest } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, { refreshInterval: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const { simple } = useInterfaceMode();
  const canWrite = useCan("devices.write");
  const [refreshing, setRefreshing] = useState(false);

  if (!device) {
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title: t("app.screens.device") }} />
        <Text color={error ? "statusError" : "inkMuted"}>
          {error ? (error.status === 404 ? t("app.screens.deviceMissing") : t("devices.loadOneFailed")) : t("common.loading")}
        </Text>
      </View>
    );
  }

  const key = deviceStatusKey(device);
  const status = DEVICE_STATUS[key];
  const online = key === "online";
  const metrics = template?.metrics ?? [];
  const chartKey = selected ?? (metrics[0] ? wireId(metrics[0]) : null);
  const zone = device.zone_id ? zones?.find((z) => z.id === device.zone_id)?.name : null;
  const w = words(simple);
  const details: [string, string][] = [
    [capital(w.template), template?.name ?? "—"],
    [capital(w.zone), zone ?? `No ${w.zone}`],
    ...(device.simulated ? [[t("app.screens.readingsLabel"), t("app.screens.simulatedReadings")] as [string, string]] : []),
    [t("devices.healthFacts.lastMessage"), device.last_seen_at ? timeAgo(device.last_seen_at) : t("devices.healthFacts.never")],
  ];
  // The web's Health facts (DESIGN.md §8), so a device-health push lands on
  // the restart and the sensor it's about.
  const faults = device.faults ?? [];
  const health: [string, string, boolean?][] = [
    ...(device.rssi != null ? [[t("app.screens.wifiSignal"), signalLabel(device.rssi)] as [string, string]] : []),
    ...(device.battery_pct != null ? [[t("devices.healthFacts.battery"), `${device.battery_pct} %`] as [string, string]] : []),
    ...(device.fw_version ? [[t("devices.healthFacts.firmware"), device.fw_version] as [string, string]] : []),
    ...(device.uptime_s != null ? [[t("devices.healthFacts.uptime"), uptime(device.uptime_s)] as [string, string]] : []),
    ...(device.boot_count != null
      ? [[t("devices.healthFacts.lastRestart"), t("devices.healthFacts.restartValue", { reason: RESTART_REASON[device.reset_reason ?? ""] ?? t("devices.healthFacts.unknown"), n: String(device.boot_count) })] as [string, string]]
      : []),
    ...(device.faults != null
      ? [faults.length === 0 ? ([t("devices.healthFacts.sensors"), t("devices.healthFacts.allAnswering")] as [string, string]) : ([t("devices.healthFacts.sensors"), faults.join("; "), true] as [string, string, boolean])]
      : []),
    ...(device.heap_free != null
      ? [[t("devices.healthFacts.memory"), device.heap_min != null ? t("devices.healthFacts.memoryLowest", { free: kb(device.heap_free), min: kb(device.heap_min) }) : t("devices.healthFacts.memoryValue", { free: kb(device.heap_free) })] as [string, string]]
      : []),
    ...(device.wifi_reconnects != null ? [[t("devices.healthFacts.rejoins"), t("devices.healthFacts.rejoinsValue", { count: device.wifi_reconnects })] as [string, string]] : []),
  ];
  const hasActuators = (template?.actuators.length ?? 0) > 0;
  const hk = healthKey(device);
  const healthWord = hk ? { key: hk, label: healthLabel(hk, device) } : null;

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([mutate(), mutateLatest()]);
    setRefreshing(false);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.inkMuted} />}
    >
      {/* The web's header: the name with its status beside it (DESIGN.md §15).
          Template, zone and the last message are in Details. */}
      <Stack.Screen
        options={{
          title: device.name,
          headerTitle: () => (
            <View style={styles.headerTitle} accessible accessibilityRole="header" accessibilityLabel={`${device.name}, ${status.label}`}>
              <Text size="title" weight="semibold" numberOfLines={2} style={styles.headerName}>
                {device.name}
              </Text>
              <View style={styles.status}>
                <StatusDot tone={status.tone} shape={status.shape} />
                <Text size="meta" weight="medium" color={status.tone === "online" ? "statusOnline" : status.tone === "offline" ? "statusOffline" : "inkMuted"}>
                  {status.label}
                </Text>
              </View>
            </View>
          ),
        }}
      />

      {/* Controls first, as on the web (ease-of-use A4). */}
      {hasActuators && (
        <View style={styles.section}>
          <Text size="section" weight="semibold" accessibilityRole="header">
            {t("devices.controls")}
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ActuatorControl device={device} />
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text size="section" weight="semibold" accessibilityRole="header">
          {t("app.screens.readingsLabel")}
        </Text>
        {metrics.length === 0 ? (
          <Text color="inkMuted">This device&apos;s template has no metrics.</Text>
        ) : (
          <View style={styles.grid}>
            {metrics.map((m) => {
              const k = wireId(m);
              const reading = latest?.find((r) => r.metric === k);
              const fresh = FRESHNESS[readingFreshness(online, m, reading?.time)];
              const value = reading ? formatReading(reading.value, m) : "—";
              const isSelected = k === chartKey;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${m.name}, ${value} ${m.unit ?? ""}, ${fresh.label}. Show its trend`}
                  onPress={() => setSelected(k)}
                  style={[
                    styles.reading,
                    { backgroundColor: theme.surface, borderColor: isSelected ? theme.accent : theme.border },
                  ]}
                >
                  {/* As on the web's Overview: name and freshness, the value, then when. */}
                  <View style={styles.readingHead}>
                    <Text size="meta" color="inkMuted" numberOfLines={1} style={styles.flex}>
                      {m.name}
                    </Text>
                    <StatusDot tone={fresh.tone} shape={fresh.tone === "online" ? "solid" : "hollow"} size={6} />
                    <Text size="micro" color={fresh.tone === "online" ? "statusOnline" : "inkMuted"}>
                      {fresh.label}
                    </Text>
                  </View>
                  <View style={styles.value}>
                    {/* A stale value is dimmed, never shown as current (DESIGN.md §5). */}
                    <Text size="title" weight="semibold" color={fresh.tone === "online" ? "ink" : "inkMuted"} style={styles.tabular}>
                      {value}
                    </Text>
                    {m.unit && m.data_type !== "bool" ? (
                      <Text size="meta" color="inkMuted">
                        {m.unit}
                      </Text>
                    ) : null}
                  </View>
                  <Text size="micro" color="inkMuted">
                    {reading ? timeAgo(reading.time) : t("devices.nothingYet")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {chartKey && (
        <View style={styles.section}>
          <Text size="section" weight="semibold" accessibilityRole="header">
            {t("devices.trend")}
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {/* The web's metric chips: pick the reading to chart. */}
            {metrics.length > 1 && (
              <Chips
                accessibilityLabel={t("app.screens.metric")}
                options={metrics.map((m) => ({ value: wireId(m), label: m.name }))}
                value={chartKey}
                onChange={setSelected}
              />
            )}
            <DeviceTrend deviceId={device.id} metricKey={chartKey} meta={metrics.find((m) => wireId(m) === chartKey)} />
          </View>
        </View>
      )}

      <Lines label={t("app.screens.details")}>
        {details.map(([label, value]) => (
          <Row key={label} title={label} right={<Text color="inkMuted">{value}</Text>} />
        ))}
      </Lines>

      {/* The web's one word first (ease-of-use A4), then the facts; Simple keeps just the word. */}
      {(healthWord || health.length > 0) && (
        <Lines label={t("devices.health")}>
          {healthWord ? (
            <Row
              key="overall"
              title={t("app.screens.overall")}
              right={<Text weight="medium" color={healthWord.key === "healthy" ? "statusOnline" : healthWord.key === "faults" ? "statusError" : "statusPending"}>{healthWord.label}</Text>}
            />
          ) : null}
          {(simple ? [] : health).map(([label, value, bad]) => (
            <Row key={label} title={label} right={<Text color={bad ? "statusError" : "inkMuted"}>{value}</Text>} />
          ))}
        </Lines>
      )}

      {canWrite && <AlertSettings device={device} onSaved={() => void mutate()} />}

      <Lines>
        <Row
          title={t("app.screens.openWeb")}
          detail={t("app.screens.deviceWebDetail")}
          onPress={() => void Linking.openURL(`${webUrl()}/devices/${device.id}`)}
          right={<ExternalLink size={18} color={theme.inkMuted} />}
        />
      </Lines>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 20 },
  headerTitle: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 2 },
  headerName: { flexShrink: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  readingHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  flex: { flex: 1 },
  section: { gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  reading: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderRadius: radius.xl, padding: 12, gap: 4 },
  value: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  tabular: { fontVariant: ["tabular-nums"] },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: 12, gap: 12 },
});
