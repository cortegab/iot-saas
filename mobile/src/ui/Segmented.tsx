import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "./Text";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** DESIGN.md §5 segmented control: mutually exclusive options; the selected
 * one lifts onto the surface. Scrolls sideways when it doesn't fit. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={accessibilityLabel}
        style={[styles.group, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={o.label}
              onPress={() => onChange(o.value)}
              style={[styles.segment, selected && { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text size="meta" weight={selected ? "medium" : "regular"} color={selected ? "ink" : "inkMuted"}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  group: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 3, gap: 2 },
  // 38 px segments in a 3 px inset: the 44 px touch height (DESIGN.md §12).
  segment: { minHeight: 38, paddingHorizontal: 12, justifyContent: "center", borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent" },
});
