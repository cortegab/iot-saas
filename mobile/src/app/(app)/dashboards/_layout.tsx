import { Stack } from "expo-router";
import { font, text } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

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
