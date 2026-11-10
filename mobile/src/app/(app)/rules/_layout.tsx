import { Stack } from "expo-router";
import { useTheme } from "@/theme/useTheme";
import { PageHeader } from "@/ui/AppHeader";

// A link straight to an item (a label QR, a notification) keeps the list
// behind it, so Back goes to the list.
export const unstable_settings = { initialRouteName: "index" };

/** Rules: the list in a stack under its tab (details open in a sheet). */
export default function RulesLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        // The web's page header under the brand bar (DESIGN.md §15).
        header: ({ options, back, navigation }) => <PageHeader options={options} back={back} navigation={navigation} />,
        contentStyle: { backgroundColor: theme.canvas },
      }}
    />
  );
}
