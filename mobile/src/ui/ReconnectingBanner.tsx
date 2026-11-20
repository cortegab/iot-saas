import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { useTheme } from "@/theme/useTheme";
import { Text } from "@/ui/Text";

/** The web's reconnecting banner (DESIGN.md §4), under the brand bar: while
 * the live connection is down, values on screen may be stale and say so. A
 * blip shorter than 1.5 s shows nothing, as on the web. */
export function ReconnectingBanner() {
  const theme = useTheme();
  const { status } = useRealtime();
  const isDown = status === "reconnecting" || status === "closed";
  // The status that has lasted 1.5 s; set only from the timer.
  const [lasted, setLasted] = useState<string | null>(null);
  useEffect(() => {
    if (!isDown) return;
    const t = setTimeout(() => setLasted(status), 1500);
    return () => clearTimeout(t);
  }, [isDown, status]);
  if (!isDown || lasted !== status) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: theme.statusPendingSurface, borderColor: theme.border }]}
    >
      <Text size="meta">
        <Text size="meta" weight="semibold">
          {status === "closed" ? "Live updates are off." : "Reconnecting…"}
        </Text>{" "}
        {status === "closed" ? "Values may be stale. Pull to refresh." : "Live updates are paused, so values may be stale."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
