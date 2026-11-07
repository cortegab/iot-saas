import type { components } from "@iodriven/shared/api";
import { useRouter } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useApiSWR } from "@/hooks/useApiSWR";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "@/ui/Text";

type AttentionResponse = components["schemas"]["AttentionResponse"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Needs attention:" above a dashboard (DESIGN.md §8), only what's non-zero.
 * Each item opens its list, filtered: Alerts, offline devices, latched rules,
 * rules that can't evaluate. */
export function AttentionStrip() {
  const theme = useTheme();
  const router = useRouter();
  const { data } = useApiSWR<AttentionResponse>("/tenants/current/attention", { refreshInterval: 30_000 });
  if (!data) return null;
  const items = [
    data.critical_alerts ? { label: plural(data.critical_alerts, "critical alert", "critical alerts"), onPress: () => router.push("/alerts") } : null,
    data.offline_devices
      ? { label: plural(data.offline_devices, "device offline", "devices offline"), onPress: () => router.push("/devices?status=offline") }
      : null,
    data.latched_rules
      ? { label: plural(data.latched_rules, "rule latched", "rules latched"), onPress: () => router.push("/rules?state=latched") }
      : null,
    data.unhealthy_rules
      ? { label: plural(data.unhealthy_rules, "rule can't evaluate", "rules can't evaluate"), onPress: () => router.push("/rules?state=stale") }
      : null,
  ].filter((i): i is { label: string; onPress: () => void } => i !== null);
  if (items.length === 0) return null;

  return (
    <View
      accessibilityRole="summary"
      style={[styles.strip, { backgroundColor: theme.statusPendingSurface, borderColor: theme.statusPending }]}
    >
      <AlertTriangle size={16} color={theme.statusPending} />
      <View style={styles.items}>
        <Text size="meta" weight="medium">
          Needs attention:
        </Text>
        {items.map((i, n) =>
          i.onPress ? (
            <Pressable key={i.label} accessibilityRole="link" hitSlop={6} onPress={i.onPress}>
              <Text size="meta" color="accent">
                {i.label}
                {n < items.length - 1 ? " ·" : ""}
              </Text>
            </Pressable>
          ) : (
            <Text key={i.label} size="meta">
              {i.label}
              {n < items.length - 1 ? " ·" : ""}
            </Text>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", gap: 8, padding: 12, borderWidth: 1, borderRadius: radius.lg, alignItems: "flex-start" },
  items: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
});
