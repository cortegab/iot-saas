import { Text as RNText, type TextProps } from "react-native";
import { font, text, type Palette } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

type Size = keyof typeof text;
type Weight = keyof typeof font;

/** Text through the five-step scale only (DESIGN.md §3); colour is a palette
 * token, ink by default. */
export function Text({
  size = "sm",
  weight = "regular",
  color = "ink",
  style,
  ...props
}: TextProps & { size?: Size; weight?: Weight; color?: keyof Palette }) {
  const theme = useTheme();
  return <RNText {...props} style={[{ fontFamily: font[weight], color: theme[color] }, text[size], style]} />;
}
