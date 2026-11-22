import { Switch as RNSwitch, StyleSheet, View } from "react-native";
import { touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

/** DESIGN.md §5 Switch in native form: On / Off for one thing, the accent
 * track when on. The label is spoken, the row shows it. */
export function Switch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  // The native switch is smaller than a fingertip; the box around it makes
  // the target at least 44 px (DESIGN.md §12), with gloves too.
  return (
    <View style={styles.target}>
      <RNSwitch
        accessibilityLabel={accessibilityLabel}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        hitSlop={8}
        trackColor={{ false: theme.border, true: theme.accent }}
        thumbColor={theme.surface}
        ios_backgroundColor={theme.border}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  target: { minWidth: touchTarget, minHeight: touchTarget, alignItems: "center", justifyContent: "center" },
});
