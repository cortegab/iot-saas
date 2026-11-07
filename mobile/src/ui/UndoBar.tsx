import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { radius, touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "./Text";

/** The web's toast with Undo, at the bottom of the screen: says what was done
 * and offers to take it back for a few seconds. */
export function UndoBar({ message, onUndo, onHide, ms = 6000 }: { message: string | null; onUndo: () => void; onHide: () => void; ms?: number }) {
  const theme = useTheme();
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onHide, ms);
    return () => clearTimeout(id);
  }, [message, ms, onHide]);
  if (!message) return null;
  return (
    <View style={[styles.bar, { backgroundColor: theme.ink }]} accessibilityLiveRegion="polite">
      <Text style={[styles.flex, { color: theme.surface }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          onUndo();
          onHide();
        }}
        hitSlop={8}
        style={styles.undo}
      >
        <Text weight="semibold" style={{ color: theme.accentMuted }}>
          Undo
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 16, right: 16, bottom: 16, borderRadius: radius.lg, paddingLeft: 14, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1, paddingVertical: 12 },
  undo: { minHeight: touchTarget, paddingHorizontal: 10, justifyContent: "center" },
});
