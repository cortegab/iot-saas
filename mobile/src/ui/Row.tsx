import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "./Text";

/** DESIGN.md §5 Line row: a bold name, a muted second line, and what sits on
 * the right. Pressable when it has `onPress`. Rows stack in a `Lines` group. */
export function Row({
  title,
  detail,
  right,
  onPress,
  selected,
  accessibilityLabel,
}: {
  title: string;
  detail?: string;
  right?: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const body = (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text weight="medium" numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text size="meta" color="inkMuted" numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole={selected === undefined ? "button" : "radio"}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? theme.surfaceRaised : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

/** A bordered group of Rows with hairlines between them. */
export function Lines({ children, label }: { children: ReactNode; label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      {label ? (
        <Text size="micro" weight="medium" color="inkMuted" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View style={[styles.lines, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {Array.isArray(children)
          ? children.filter(Boolean).map((child, i) => (
              <View key={i} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSoft } : null}>
                {child}
              </View>
            ))
          : children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchTarget + 8, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1, gap: 2 },
  group: { gap: 6 },
  label: { paddingHorizontal: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  lines: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
});
