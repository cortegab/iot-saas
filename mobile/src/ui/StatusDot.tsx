import type { DotShape, StatusTone } from "@iodriven/shared/device-status";
import { View } from "react-native";
import type { Palette } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

const TONE: Record<StatusTone, keyof Palette> = {
  online: "statusOnline",
  offline: "statusOffline",
  unknown: "statusUnknown",
  pending: "statusPending",
  error: "statusError",
  accent: "accent",
};

/** The web Badge's dot (DESIGN.md §5): colour by tone, and a shape so status
 * never relies on colour alone (solid, hollow ring, square). */
export function StatusDot({ tone, shape = "solid", size = 8 }: { tone: StatusTone; shape?: DotShape; size?: number }) {
  const theme = useTheme();
  const color = theme[TONE[tone]];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: shape === "square" ? 1.5 : size / 2,
        backgroundColor: shape === "hollow" ? "transparent" : color,
        borderWidth: shape === "hollow" ? 1.5 : 0,
        borderColor: color,
      }}
    />
  );
}

export function toneColor(tone: StatusTone): keyof Palette {
  return TONE[tone];
}
