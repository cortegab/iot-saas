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
import { DeviceTrend } from "@/chart/DeviceTrend";
import { useApiSWR } from "@/hooks/useApiSWR";
import { webUrl } from "@/lib/config";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Lines, Row } from "@/ui/Row";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

const FRESHNESS: Record<Freshness, { label: string; tone: "online" | "unknown" }> = {
  live: { label: "Live", tone: "online" },
  stale: { label: "Stale", tone: "unknown" },
  none: { label: "No data", tone: "unknown" },
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
export default function DeviceScreen() {
  const theme = useTheme();
  const { deviceId } = useLocalSearchParams<{ deviceId: string }>();
  const { data: device, error, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`, { refreshInterval: 30_000 });
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  const { data: latest, mutate: mutateLatest } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, { refreshInterval: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (!device) {
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title: "Device" }} />
        <Text color={error ? "statusError" : "inkMuted"}>
          {error ? (error.status === 404 ? "This device doesn't exist in this workspace." : "Couldn't load this device.") : "Loading…"}
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
  const health: [string, string][] = [
    ["Last message", device.last_seen_at ? timeAgo(device.last_seen_at) : "Never"],
    ...(device.rssi != null ? [["Wi-Fi signal", `${device.rssi} dBm`] as [string, string]] : []),
    ...(device.battery_pct != null ? [["Battery", `${device.battery_pct} %`] as [string, string]] : []),
    ...(device.uptime_s != null ? [["Uptime", uptime(device.uptime_s)] as [string, string]] : []),
    ...(device.fw_version ? [["Firmware", device.fw_version] as [string, string]] : []),
  ];

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
      <Stack.Screen options={{ title: device.name }} />

      <View style={styles.status}>
        <StatusDot tone={status.tone} shape={status.shape} />
        <Text size="meta" weight="medium" color={status.tone === "online" ? "statusOnline" : status.tone === "offline" ? "statusOffline" : "inkMuted"}>
          {status.label}
        </Text>
        <Text size="meta" color="inkMuted" style={styles.flex} numberOfLines={2}>
          {[template?.name, zone ?? "No zone", key === "never" ? null : `last message ${timeAgo(device.last_seen_at)}`].filter(Boolean).join(" · ")}
        </Text>
      </View>

      <View style={styles.section}>
        <Text size="section" weight="semibold" accessibilityRole="header">
          Readings
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
                  <Text size="meta" color="inkMuted" numberOfLines={1}>
                    {m.name}
                  </Text>
                  <View style={styles.value}>
                    <Text size="title" weight="semibold" style={styles.tabular}>
                      {value}
                    </Text>
                    {m.unit && m.data_type !== "bool" ? (
                      <Text size="meta" color="inkMuted">
                        {m.unit}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.fresh}>
                    <StatusDot tone={fresh.tone} shape={fresh.tone === "online" ? "solid" : "hollow"} size={6} />
                    <Text size="micro" color="inkMuted">
                      {fresh.label}
                      {reading && fresh.label !== "Live" ? ` · ${timeAgo(reading.time)}` : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {chartKey && (
        <View style={styles.section}>
          <Text size="section" weight="semibold" accessibilityRole="header">
            Trend · {metrics.find((m) => wireId(m) === chartKey)?.name ?? chartKey}
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <DeviceTrend deviceId={device.id} metricKey={chartKey} meta={metrics.find((m) => wireId(m) === chartKey)} />
          </View>
        </View>
      )}

      <Lines label="Health">
        {health.map(([label, value]) => (
          <Row key={label} title={label} right={<Text color="inkMuted">{value}</Text>} />
        ))}
      </Lines>

      <Lines>
        <Row
          title="Open on the web"
          detail="Settings, wiring, rules and controls."
          onPress={() => void Linking.openURL(`${webUrl()}/devices/${device.id}`)}
          right={<ExternalLink size={18} color={theme.inkMuted} />}
        />
      </Lines>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 20 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  section: { gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  reading: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderRadius: radius.xl, padding: 12, gap: 4 },
  value: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  tabular: { fontVariant: ["tabular-nums"] },
  fresh: { flexDirection: "row", alignItems: "center", gap: 6 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: 12 },
});
