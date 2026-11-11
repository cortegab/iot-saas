import type { components } from "@iodriven/shared/api";
import { DEVICE_STATUS, deviceStatusKey, type DeviceStatusKey } from "@iodriven/shared/device-status";
import { statusCounts, visibleDevices, type StatusFilter as Filter } from "@/devices/list";
import { timeAgo } from "@iodriven/shared/time-ago";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useApiSWR } from "@/hooks/useApiSWR";
import { touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { SearchField } from "@/ui/SearchField";
import { Segmented } from "@/ui/Segmented";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];
const ORDER: DeviceStatusKey[] = ["online", "offline", "never", "disabled"];

/** The workspace's devices (DESIGN.md §6 on a phone): search by name, the
 * status filter with a count per state, and a row per device that opens it. */
export default function Devices() {
  const theme = useTheme();
  const router = useRouter();
  const { data: devices, error, isLoading, mutate } = useApiSWR<DeviceResponse[]>("/devices", { refreshInterval: 30_000 });
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  const [query, setQuery] = useState("");
  // ?status=offline from the attention strip opens the list filtered, also
  // when the tab is already open; a status picked here wins until the next link.
  const { status } = useLocalSearchParams<{ status?: string }>();
  const fromLink: Filter = status === "online" || status === "offline" || status === "never" || status === "disabled" ? status : "all";
  const [picked, setPicked] = useState<{ link: string | undefined; value: Filter } | null>(null);
  const filter = picked && picked.link === status ? picked.value : fromLink;
  const setFilter = (value: Filter) => setPicked({ link: status, value });
  const [refreshing, setRefreshing] = useState(false);

  const templateName = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t.name])), [templates]);
  const zoneName = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z.name])), [zones]);

  const counts = useMemo(() => statusCounts(devices ?? []), [devices]);
  const rows = useMemo(() => visibleDevices(devices ?? [], filter, query), [devices, filter, query]);

  const options = [
    { value: "all" as Filter, label: `All ${devices?.length ?? ""}`.trim() },
    ...ORDER.filter((k) => counts[k] > 0 || filter === k).map((k) => ({ value: k as Filter, label: `${DEVICE_STATUS[k].label} ${counts[k]}` })),
  ];

  async function onRefresh() {
    setRefreshing(true);
    await mutate();
    setRefreshing(false);
  }

  const empty = isLoading ? (
    <Text color="inkMuted">Loading devices…</Text>
  ) : error && !devices ? (
    <Text color="statusError">Couldn&apos;t load devices. Pull down to try again.</Text>
  ) : (devices?.length ?? 0) === 0 ? (
    <Text color="inkMuted">No devices yet. Add one on the web: More → Open IO Driven on the web.</Text>
  ) : (
    <Text color="inkMuted">No devices match. Clear the search or pick another status.</Text>
  );

  return (
    <>
      {/* Scan is in the top bar, on every screen (DESIGN.md §15). */}
      <Stack.Screen options={{ title: "Devices" }} />
      <FlatList
        data={rows}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.inkMuted} />}
        ListHeaderComponent={
          <View style={styles.head}>
            <SearchField label="Search devices" value={query} onChangeText={setQuery} />
            <Segmented accessibilityLabel="Status" options={options} value={filter} onChange={setFilter} />
          </View>
        }
        ListEmptyComponent={<View style={styles.empty}>{empty}</View>}
        renderItem={({ item: d, index }) => {
          const key = deviceStatusKey(d);
          const s = DEVICE_STATUS[key];
          const where = [templateName.get(d.catalog_entry_id), d.zone_id ? zoneName.get(d.zone_id) : null].filter(Boolean).join(" · ");
          const seen = key === "never" ? "Never connected" : `last message ${timeAgo(d.last_seen_at)}`;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${d.name}, ${s.label}, ${seen}`}
              onPress={() => router.push(`/devices/${d.id}`)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.surfaceRaised : theme.surface, borderColor: theme.border },
                index === 0 && styles.first,
                index === rows.length - 1 && styles.last,
              ]}
            >
              <StatusDot tone={s.tone} shape={s.shape} />
              <View style={styles.text}>
                <Text weight="medium" numberOfLines={1}>
                  {d.name}
                </Text>
                <Text size="meta" color="inkMuted" numberOfLines={1}>
                  {[where, seen].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <ChevronRight size={18} color={theme.inkMuted} />
            </Pressable>
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16 },
  head: { gap: 12, marginBottom: 12 },
  empty: { paddingVertical: 24 },
  row: {
    minHeight: touchTarget + 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  first: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  last: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  text: { flex: 1, gap: 2 },
});
