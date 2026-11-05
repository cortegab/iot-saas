import type { components } from "@iodriven/shared/api";
import { DEFAULT_RANGE_MS, RANGE_OPTIONS } from "@iodriven/shared/chart-range";
import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSWRConfig } from "swr";
import { AttentionStrip } from "@/dashboards/AttentionStrip";
import { readingOrder } from "@/dashboards/order";
import { DashboardWidget } from "@/dashboards/widgets";
import { useApiSWR } from "@/hooks/useApiSWR";
import { webUrl } from "@/lib/config";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";

type DashboardResponse = components["schemas"]["DashboardResponse"];

/** One dashboard on a phone: the attention strip, one time range for every
 * trend (the web's header range), and the widgets one per row in reading
 * order. Arranging it stays on the web. */
export default function DashboardScreen() {
  const theme = useTheme();
  const { dashboardId } = useLocalSearchParams<{ dashboardId: string }>();
  const { data: dashboard, error } = useApiSWR<DashboardResponse>(`/dashboards/${dashboardId}`);
  const { mutate } = useSWRConfig();
  const [rangeMs, setRangeMs] = useState(DEFAULT_RANGE_MS);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    // Everything on screen: the dashboard, its devices, readings and charts.
    await mutate((key) => typeof key === "string" && (key.startsWith("/dashboards/") || key.startsWith("/devices/") || key.startsWith("/tenants/")));
    setRefreshing(false);
  }

  if (!dashboard) {
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title: "Dashboard" }} />
        <Text color={error ? "statusError" : "inkMuted"}>
          {error ? (error.status === 404 ? "This dashboard doesn't exist in this workspace." : "Couldn't load this dashboard.") : "Loading…"}
        </Text>
      </View>
    );
  }

  const widgets = readingOrder(dashboard.layout);
  const hasTrend = widgets.some((w) => w.type === "trend_chart");

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.inkMuted} />}
    >
      <Stack.Screen options={{ title: dashboard.name }} />
      {dashboard.is_default ? (
        <Text size="micro" weight="medium" color="inkMuted">
          DEFAULT DASHBOARD
        </Text>
      ) : null}
      <AttentionStrip />
      {hasTrend ? (
        <Segmented
          accessibilityLabel="Time range"
          options={RANGE_OPTIONS.map((o) => ({ value: String(o.ms), label: o.label }))}
          value={String(rangeMs)}
          onChange={(v) => setRangeMs(Number(v))}
        />
      ) : null}
      {widgets.length === 0 ? (
        <View style={styles.empty}>
          <Text weight="medium">This dashboard has no widgets yet</Text>
          <Text color="inkMuted">Add them on the web, in Edit layout.</Text>
          <Button variant="secondary" label="Open on the web" onPress={() => void Linking.openURL(`${webUrl()}/dashboards/${dashboard.id}`)} />
        </View>
      ) : (
        widgets.map((w) => <DashboardWidget key={w.id} w={w} rangeMs={rangeMs} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  empty: { gap: 8, paddingVertical: 12, alignItems: "flex-start" },
});
