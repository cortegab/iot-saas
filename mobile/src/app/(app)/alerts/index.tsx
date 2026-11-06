import type { components } from "@iodriven/shared/api";
import type { ApiPage } from "@iodriven/shared/api-client";
import { formatWhen, timeAgo } from "@iodriven/shared/time-ago";
import { Stack, useRouter } from "expo-router";
import { AlertTriangle, Bell, Info, Mail, Zap } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import useSWRInfinite from "swr/infinite";
import {
  groupsPageKey,
  PAGE_SIZE,
  TYPES,
  useNotificationActions,
  useNotificationSummary,
  type AlertFilter,
  type AlertGroup,
} from "@/alerts/notifications";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { touchTarget, type Palette } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { UndoBar } from "@/ui/UndoBar";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type Severity = components["schemas"]["NotificationResponse"]["severity"];

const SEVERITY: Record<Severity, { icon: typeof Bell; label: string; color: keyof Palette }> = {
  critical: { icon: AlertTriangle, label: "Critical", color: "statusError" },
  warning: { icon: Zap, label: "Warning", color: "statusPending" },
  info: { icon: Info, label: "Info", color: "inkMuted" },
};

/** Alerts (the web's Notifications on a phone, DESIGN.md §8 / §15): one row
 * per alert with repeats grouped (×N), unread marked by the accent bar and a
 * bold title, the web's state filter (All · Unread · unread by type), paged
 * by the API as you scroll. Tapping opens its details and marks it read;
 * the sheet marks it unread or dismisses it, with Undo. */
export default function Alerts() {
  const theme = useTheme();
  const api = useApi();
  const router = useRouter();
  const { summary, unread, error: summaryError } = useNotificationSummary();
  const actions = useNotificationActions();
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const deviceName = useMemo(() => new Map((devices ?? []).map((d) => [d.id, d.name])), [devices]);
  const ruleName = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r.name])), [rules]);

  const [filter, setFilter] = useState<AlertFilter>("all");
  const { data, error, isLoading, size, setSize, mutate, isValidating } = useSWRInfinite<ApiPage<AlertGroup>>(
    (index, prev: ApiPage<AlertGroup> | null) => (prev && (index * PAGE_SIZE >= prev.total || prev.items.length === 0) ? null : groupsPageKey(filter, index)),
    (key: string) => api.getPage<AlertGroup>(key),
    { refreshInterval: 30_000, revalidateFirstPage: true },
  );
  const groups = (data ?? []).flatMap((p) => p.items);
  const total = data?.[0]?.total ?? 0;
  const [open, setOpen] = useState<AlertGroup | null>(null);
  const [undo, setUndo] = useState<{ message: string; ids: string[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const options = [
    { value: "all" as AlertFilter, label: `All ${summary?.alerts ?? ""}`.trim() },
    { value: "unread" as AlertFilter, label: `Unread ${unread}` },
    ...TYPES.filter((t) => (summary?.unread_by_type[t.value] ?? 0) > 0 || filter === t.value).map((t) => ({
      value: t.value as AlertFilter,
      label: `${t.label} ${summary?.unread_by_type[t.value] ?? 0}`,
    })),
  ];

  const run = useCallback(async (fn: () => Promise<unknown>, what: string) => {
    setFailed(null);
    try {
      await fn();
    } catch {
      setFailed(`Couldn't ${what}. Check your connection and try again.`);
    }
  }, []);

  function openAlert(g: AlertGroup) {
    setOpen(g);
    if (g.unread_count > 0) void run(() => actions.markRead(g.key), "mark it as read");
  }

  async function dismiss(g: AlertGroup) {
    setOpen(null);
    await run(async () => {
      const ids = await actions.dismiss(g.key);
      setUndo({ message: ids.length > 1 ? `${ids.length} notifications dismissed` : "Notification dismissed", ids });
    }, "dismiss it");
  }

  async function onRefresh() {
    setRefreshing(true);
    await mutate();
    setRefreshing(false);
  }

  const hideUndo = useCallback(() => setUndo(null), []);
  const loadError = (summaryError ?? error) && !data;

  const empty = isLoading ? (
    <Text color="inkMuted">Loading alerts…</Text>
  ) : loadError ? (
    <Text color="statusError">Couldn&apos;t load alerts. Pull down to try again.</Text>
  ) : summary?.alerts === 0 ? (
    <View style={styles.emptyBlock}>
      <Text weight="semibold">Nothing needs attention</Text>
      <Text color="inkMuted">No alerts. New ones appear here, with a count on the Alerts tab.</Text>
    </View>
  ) : (
    <Text color="inkMuted">{filter === "unread" ? "Every notification has been read." : "Nothing of this type is waiting to be read."}</Text>
  );

  return (
    <View style={styles.flex}>
      <Stack.Screen
        options={{
          title: "Alerts",
          headerRight: () =>
            unread > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void run(actions.markAllRead, "mark them as read")}
                hitSlop={8}
                style={styles.headerButton}
              >
                <Text weight="medium" color="accent">
                  Mark all read
                </Text>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.inkMuted} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (groups.length < total && !isValidating) void setSize(size + 1);
        }}
        ListHeaderComponent={
          <View style={styles.head}>
            <Segmented accessibilityLabel="Filter by state" options={options} value={filter} onChange={setFilter} />
            {failed && <Text color="statusError">{failed}</Text>}
          </View>
        }
        ListEmptyComponent={<View style={styles.empty}>{empty}</View>}
        ListFooterComponent={
          groups.length > 0 ? (
            <Text size="micro" color="inkMuted" style={styles.footer}>
              {groups.length < total ? `${groups.length} of ${total} alerts · loading more as you scroll` : `${total} alert${total === 1 ? "" : "s"}`}
            </Text>
          ) : undefined
        }
        renderItem={({ item: g, index }) => {
          const n = g.latest;
          const sev = SEVERITY[n.severity];
          const Icon = n.kind === "delivery_failed" ? Mail : sev.icon;
          const isUnread = g.unread_count > 0;
          const source = [
            n.device_id ? (deviceName.get(n.device_id) ?? "deleted device") : null,
            n.rule_id ? `rule ${ruleName.get(n.rule_id) ?? "deleted"}` : null,
          ].filter(Boolean);
          const when = g.count > 1 ? `since ${formatWhen(g.first_at)}, last ${timeAgo(g.last_at)}` : timeAgo(g.last_at);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${sev.label}${isUnread ? ", unread" : ""}: ${n.message}${g.count > 1 ? `, ${g.count} times` : ""}`}
              onPress={() => openAlert(g)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.surfaceRaised : theme.surface, borderColor: theme.border },
                isUnread && { borderLeftColor: theme.accent, borderLeftWidth: 3 },
                index === 0 && styles.first,
                index === groups.length - 1 && styles.last,
              ]}
            >
              <Icon size={17} color={theme[sev.color]} style={styles.icon} />
              <View style={styles.text}>
                <Text weight={isUnread ? "semibold" : "regular"}>
                  {n.message}
                  {g.count > 1 ? (
                    <Text size="meta" color="inkMuted">
                      {`  ×${g.count}`}
                    </Text>
                  ) : null}
                </Text>
                {n.detail ? (
                  <Text size="meta" color="inkMuted">
                    {n.detail}
                  </Text>
                ) : null}
                <Text size="micro" color="inkMuted">
                  {[when, ...source].join(" · ")}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Sheet
        open={open != null}
        onClose={() => setOpen(null)}
        title={open?.latest.message ?? "Notification"}
        sub={open ? `${SEVERITY[open.latest.severity].label}${open.count > 1 ? ` · ${open.count} times` : ""}` : undefined}
        footer={
          open ? (
            <>
              {open.latest.device_id && deviceName.has(open.latest.device_id) ? (
                <Button
                  label="Open device"
                  onPress={() => {
                    const id = open.latest.device_id!;
                    setOpen(null);
                    router.push({ pathname: "/devices/[deviceId]", params: { deviceId: id } });
                  }}
                />
              ) : (
                <Button label="Done" onPress={() => setOpen(null)} />
              )}
              <Button
                label="Mark as unread"
                variant="secondary"
                onPress={() => {
                  const key = open.key;
                  setOpen(null);
                  void run(() => actions.markUnread(key), "mark it as unread");
                }}
              />
              <Button label="Dismiss" variant="danger" onPress={() => void dismiss(open)} />
            </>
          ) : null
        }
      >
        {open && (
          <>
            {open.latest.detail ? <Text>{open.latest.detail}</Text> : null}
            <Facts
              facts={[
                open.latest.device_id ? ["Device", deviceName.get(open.latest.device_id) ?? "Deleted device"] : null,
                open.latest.rule_id ? ["Rule", ruleName.get(open.latest.rule_id) ?? "Deleted rule"] : null,
                [open.count > 1 ? "First" : "When", formatWhen(open.first_at)],
                open.count > 1 ? ["Last", `${formatWhen(open.last_at)} · ${open.count} times`] : null,
              ]}
            />
            {open.latest.kind === "delivery_failed" && (
              <Text size="meta" color="inkMuted">
                Retry failed deliveries on the web, in the rule&apos;s activity.
              </Text>
            )}
          </>
        )}
      </Sheet>

      <UndoBar message={undo?.message ?? null} onUndo={() => undo && void run(() => actions.restore(undo.ids), "undo it")} onHide={hideUndo} />
    </View>
  );
}

function Facts({ facts }: { facts: ([string, string] | null)[] }) {
  return (
    <View style={styles.facts}>
      {facts.filter((f): f is [string, string] => f != null).map(([k, v]) => (
        <View key={k} style={styles.fact}>
          <Text size="meta" color="inkMuted" style={styles.factKey}>
            {k}
          </Text>
          <Text size="meta" style={styles.flex}>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 16, paddingBottom: 88 },
  head: { gap: 12, marginBottom: 12 },
  empty: { paddingVertical: 24 },
  emptyBlock: { gap: 4 },
  headerButton: { minHeight: touchTarget, justifyContent: "center", paddingHorizontal: 4 },
  row: {
    minHeight: touchTarget + 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  first: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  last: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  icon: { marginTop: 2 },
  text: { flex: 1, gap: 2 },
  footer: { textAlign: "center", paddingVertical: 12 },
  facts: { gap: 6 },
  fact: { flexDirection: "row", gap: 12 },
  factKey: { width: 72 },
});
