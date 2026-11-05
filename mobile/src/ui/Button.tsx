import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { radius, touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "./Text";

/** DESIGN.md §5 Button: primary (accent) or secondary, 44 px on touch. While
 * `busy` it shows a spinner and doesn't press again. */
export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const primary = variant === "primary";
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: theme.accent, borderColor: theme.accent }
          : { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
        { opacity: off ? 0.55 : pressed ? 0.8 : 1 },
      ]}
    >
      <View style={styles.row}>
        {busy && <ActivityIndicator size="small" color={primary ? theme.onAccent : theme.ink} />}
        <Text weight="medium" color={primary ? "onAccent" : variant === "danger" ? "statusError" : "ink"}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
