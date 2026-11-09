import type { components } from "@iodriven/shared/api";
import { ApiRequestError } from "@iodriven/shared/api-client";
import { RULE_STATE, ruleStateKey } from "@iodriven/shared/rule-text";
import { timeAgo } from "@iodriven/shared/time-ago";
import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useCan } from "@/hooks/useCan";
import { webUrl } from "@/lib/config";
import { matchesFilter, ruleCounts, ruleSentence, scheduleOrNull, type RuleFilter } from "@/rules/rules";
import { touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { StatusDot } from "@/ui/StatusDot";
import { Switch } from "@/ui/Switch";
import { Text } from "@/ui/Text";
import { UndoBar } from "@/ui/UndoBar";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];

const FILTERS: { value: RuleFilter; label: string }[] = [
  { value: "armed", label: "Armed" },
  { value: "latched", label: "Latched" },
  { value: "stale", label: "Can't evaluate" },
  { value: "disabled", label: "Disabled" },
];

function confirm(title: string, body: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

/** Rules (the web's list on a phone, DESIGN.md §8 / §15): each rule's state,
 * what it does in the web's words, and how it's doing (fired in 24 h, can't
 * evaluate). Admins turn a rule on or off (with Undo) and reset a latched
 * one. Creating and editing stay on the web. */
export default function Rules() {
  const theme = useTheme();
  const api = useApi();
  const router = useRouter();
  const canWrite = useCan("rules.write");
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleResponse[]>("/rules", { refreshInterval: 30_000 });
  const { data: activity } = useApiSWR<RuleActivityResponse[]>("/rules/activity", { refreshInterval: 60_000 });
  const activityByRule = useMemo(() => new Map((activity ?? []).map((a) => [a.rule_id, a])), [activity]);
  // ?state=latched from the attention strip opens the list filtered;
  // ?rule=<id> (an alert's rule link) opens that rule's sheet.
  const { state, rule: linkedRule } = useLocalSearchParams<{ state?: string; rule?: string }>();
  const fromLink: RuleFilter = state === "latched" || state === "stale" ? state : "all";
  const [picked, setPicked] = useState<{ link: string | undefined; value: RuleFilter } | null>(null);
  const filter = picked && picked.link === state ? picked.value : fromLink;
  const [opened, setOpened] = useState<{ link: string | undefined; id: string | null } | null>(null);
  const open = opened && opened.link === linkedRule ? opened.id : (linkedRule ?? null);
  const setOpen = (id: string | null) => setOpened({ link: linkedRule, id });
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ message: string; rule: RuleResponse; enabled: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const all = useMemo(() => [...(rules ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [rules]);
  const counts = useMemo(() => ruleCounts(all), [all]);
  const rows = all.filter((r) => matchesFilter(r, filter));
  const openRule = all.find((r) => r.id === open) ?? null;

  const options = [
    { value: "all" as RuleFilter, label: `All ${counts.all}` },
    ...FILTERS.filter((f) => counts[f.value] > 0 || filter === f.value).map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value]}` })),
  ];

  const setEnabled = useCallback(
    async (rule: RuleResponse, enabled: boolean, undoable = true) => {
      setBusy(rule.id);
      setFailed(null);
      try {
        await api.patch(`/rules/${rule.id}`, { enabled });
        await mutate();
        if (undoable) setUndo({ message: `${rule.name} ${enabled ? "enabled" : "disabled"}`, rule, enabled });
      } catch (err) {
        setFailed(err instanceof ApiRequestError ? `Couldn't update ${rule.name}: ${err.message}` : `Couldn't update ${rule.name}. Check your connection and try again.`);
      } finally {
        setBusy(null);
      }
    },
    [api, mutate],
  );

  async function resetLatch(rule: RuleResponse) {
    const ok = await confirm(
      `Reset ${rule.name}?`,
      "It's latched: it fired and waits for someone to reset it. Resetting arms it again, so it fires the next time its condition holds.",
      "Reset latch",
    );
    if (!ok) return;
    setBusy(rule.id);
    setFailed(null);
    try {
      await api.post(`/rules/${rule.id}/reset`, {});
      // The worker clears the flag a moment later.
      setTimeout(() => void mutate(), 1000);
    } catch (err) {
      setFailed(err instanceof ApiRequestError ? `Couldn't reset ${rule.name}: ${err.message}` : `Couldn't reset ${rule.name}. Check your connection and try again.`);
    } finally {
      setBusy(null);
    }
  }

  const hideUndo = useCallback(() => setUndo(null), []);

  const empty = isLoading ? (
    <Text color="inkMuted">Loading rules…</Text>
  ) : error && !rules ? (
    <Text color="statusError">Couldn&apos;t load rules. Pull down to try again.</Text>
  ) : all.length === 0 ? (
    <Text color="inkMuted">No rules yet. Create one on the web: More → Open IO Driven on the web.</Text>
  ) : (
    <Text color="inkMuted">No rules in this state.</Text>
  );

  function statusLine(r: RuleResponse): string {
    const a = activityByRule.get(r.id);
    const parts = [scheduleOrNull(r) ?? (a ? (a.fired ? `fired ${a.fired}× in 24 h` : "quiet in 24 h") : null)];
    if (r.enabled && !r.health.evaluatable) parts.push("can't evaluate");
    return parts.filter(Boolean).join(" · ");
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: "Rules" }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void mutate().finally(() => setRefreshing(false));
            }}
            tintColor={theme.inkMuted}
          />
        }
        ListHeaderComponent={
          <View style={styles.head}>
            <Segmented accessibilityLabel="Filter by state" options={options} value={filter} onChange={(value) => setPicked({ link: state, value })} />
            {failed && <Text color="statusError">{failed}</Text>}
          </View>
        }
        ListEmptyComponent={<View style={styles.empty}>{empty}</View>}
        renderItem={({ item: r, index }) => {
          const st = RULE_STATE[ruleStateKey(r)];
          const line = statusLine(r);
          return (
            <View
              style={[
                styles.row,
                { backgroundColor: theme.surface, borderColor: theme.border },
                index === 0 && styles.first,
                index === rows.length - 1 && styles.last,
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${r.name}, ${st.label}. ${ruleSentence(r)}`}
                onPress={() => setOpen(r.id)}
                style={styles.main}
              >
                <View style={styles.title}>
                  <StatusDot tone={st.tone} shape={st.shape} />
                  <Text weight="medium" numberOfLines={1} style={styles.flex}>
                    {r.name}
                  </Text>
                  <Text size="micro" color={st.tone === "pending" ? "statusPending" : "inkMuted"}>
                    {st.label}
                  </Text>
                </View>
                <Text size="meta" color="inkMuted" numberOfLines={2}>
                  {ruleSentence(r)}
                </Text>
                {line ? (
                  <Text size="micro" color={r.enabled && !r.health.evaluatable ? "statusPending" : "inkMuted"}>
                    {line}
                  </Text>
                ) : null}
              </Pressable>
              {canWrite && (
                <View style={styles.side}>
                  <Switch
                    accessibilityLabel={`${r.name} on`}
                    value={r.enabled}
                    disabled={busy === r.id}
                    onValueChange={(on) => void setEnabled(r, on)}
                  />
                </View>
              )}
            </View>
          );
        }}
      />

      <Sheet
        open={openRule != null}
        onClose={() => setOpen(null)}
        title={openRule?.name ?? "Rule"}
        sub={openRule ? RULE_STATE[ruleStateKey(openRule)].label : undefined}
        footer={
          openRule ? (
            <>
              {canWrite && openRule.latched && openRule.enabled && (
                <Button label="Reset latch" busy={busy === openRule.id} onPress={() => void resetLatch(openRule)} />
              )}
              <Button label="Edit on the web" variant="secondary" onPress={() => void Linking.openURL(`${webUrl()}/rules/${openRule.id}`)} />
              <Button label="Done" variant="secondary" onPress={() => setOpen(null)} />
            </>
          ) : null
        }
      >
        {openRule && (
          <>
            <Text>{ruleSentence(openRule)}</Text>
            {openRule.description ? <Text color="inkMuted">{openRule.description}</Text> : null}
            {canWrite && (
              <View style={styles.toggle}>
                <View style={styles.flex}>
                  <Text weight="medium">{openRule.enabled ? "On" : "Off"}</Text>
                  <Text size="meta" color="inkMuted">
                    {openRule.enabled ? "Fires when its trigger and conditions are met." : "Keeps its settings and history, but won't fire."}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={`${openRule.name} on`}
                  value={openRule.enabled}
                  disabled={busy === openRule.id}
                  onValueChange={(on) => void setEnabled(openRule, on)}
                />
              </View>
            )}
            {openRule.latched && (
              <Text color="statusPending">Latched: it fired and waits for a reset before it can fire again.</Text>
            )}
            {openRule.health.signals.length > 0 && (
              <View style={styles.signals}>
                <Text size="meta" weight="medium" color="inkMuted">
                  Inputs
                </Text>
                {openRule.health.signals.map((s) => (
                  <View key={`${s.device_id}/${s.metric}`} style={styles.signal}>
                    <Pressable
                      accessibilityRole="link"
                      style={styles.flex}
                      onPress={() => {
                        setOpen(null);
                        router.push({ pathname: "/devices/[deviceId]", params: { deviceId: s.device_id } });
                      }}
                    >
                      <Text size="meta">
                        {s.metric} on <Text size="meta" color="accent">{s.device_name ?? "a device"}</Text>
                      </Text>
                    </Pressable>
                    <Text size="meta" color={s.state === "fresh" ? "ink" : "statusPending"}>
                      {s.last_value ?? "—"} · {s.state === "fresh" ? timeAgo(s.last_seen_at) : s.state}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </Sheet>

      <UndoBar
        message={undo?.message ?? null}
        onUndo={() => undo && void setEnabled(undo.rule, !undo.enabled, false)}
        onHide={hideUndo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 16, paddingBottom: 88 },
  head: { gap: 12, marginBottom: 12 },
  empty: { paddingVertical: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  first: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  last: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  main: { flex: 1, minHeight: touchTarget + 12, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  title: { flexDirection: "row", alignItems: "center", gap: 8 },
  side: { paddingRight: 12 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12 },
  signals: { gap: 6 },
  signal: { flexDirection: "row", alignItems: "center", gap: 8 },
});
