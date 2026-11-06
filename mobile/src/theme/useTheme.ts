import { useColorScheme } from "react-native";
import { dark, light, type Palette } from "./tokens";

/** The palette for the phone's light / dark setting. */
export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
