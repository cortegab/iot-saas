import { Stack } from "expo-router";
import { font, text } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

// A link straight to an item (a label QR, a notification) keeps the list
// behind it, so Back goes to the list.
export const unstable_settings = { initialRouteName: "index" };

/** Dashboards: the list, then each item's screen, in one stack under its tab. */
export default function DashboardsLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.ink,
        headerTitleStyle: { fontFamily: font.semibold, fontSize: text.section.fontSize },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.canvas },
      }}
    />
  );
}
