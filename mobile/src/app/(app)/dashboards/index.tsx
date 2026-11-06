import type { components } from "@iodriven/shared/api";
import { Stack, useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { AttentionStrip } from "@/dashboards/AttentionStrip";
import { sortDashboards } from "@/dashboards/order";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useTheme } from "@/theme/useTheme";
import { Lines, Row } from "@/ui/Row";
import { Text } from "@/ui/Text";

type DashboardResponse = components["schemas"]["DashboardResponse"];

const widgets = (n: number) => `${n} widget${n === 1 ? "" : "s"}`;

/** The workspace's dashboards, your default first (DESIGN.md §8). Making
 * and arranging them stays on the web. */
export default function Dashboards() {
  const theme = useTheme();
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");
  const [refreshing, setRefreshing] = useState(false);
  const list = useMemo(() => sortDashboards(data ?? []), [data]);

  async function onRefresh() {
    setRefreshing(true);
    await mutate();
    setRefreshing(false);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.inkMuted} />}
    >
      <Stack.Screen options={{ title: "Dashboards" }} />
      <AttentionStrip />
      {isLoading ? (
        <Text color="inkMuted">Loading dashboards…</Text>
      ) : error && !data ? (
        <Text color="statusError">Couldn&apos;t load dashboards. Pull down to try again.</Text>
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <Text weight="medium">No dashboards yet</Text>
          <Text color="inkMuted">Make one on the web: More → Open IO Driven on the web.</Text>
        </View>
      ) : (
        <Lines>
          {list.map((d) => (
            <Row
              key={d.id}
              title={d.name}
              detail={[d.is_default ? "Default" : null, widgets(d.layout.length)].filter(Boolean).join(" · ")}
              onPress={() => router.push(`/dashboards/${d.id}`)}
              right={<ChevronRight size={18} color={theme.inkMuted} />}
            />
          ))}
        </Lines>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  empty: { gap: 4, paddingVertical: 12 },
});
