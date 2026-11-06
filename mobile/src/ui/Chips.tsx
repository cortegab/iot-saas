import { Pressable, ScrollView, StyleSheet } from "react-native";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "./Text";

/** Pick one item from a short list (the web trend card's metric chips):
 * the picked chip fills with the accent. Scrolls sideways when it doesn't
 * fit. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={styles.row}
    >
      {options.map((o) => {
        const picked = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: picked }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              picked ? { backgroundColor: theme.accent, borderColor: theme.accent } : { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text size="meta" weight="medium" color={picked ? "onAccent" : "ink"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  // 36 px chips with 4 px of hit slop around them: the 44 px touch target.
  chip: { minHeight: 36, minWidth: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
