import { Switch as RNSwitch } from "react-native";
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
  return (
    <RNSwitch
      accessibilityLabel={accessibilityLabel}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: theme.border, true: theme.accent }}
      thumbColor={theme.surface}
      ios_backgroundColor={theme.border}
    />
  );
}
