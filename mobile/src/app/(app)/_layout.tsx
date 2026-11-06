import { Redirect, Tabs } from "expo-router";
import { Bell, Cpu, LayoutDashboard, Menu } from "lucide-react-native";
import { AppState } from "react-native";
import { SWRConfig } from "swr";
import { useAuth } from "@/auth/AuthProvider";
import { useNotificationSummary } from "@/alerts/notifications";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { font, text } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

/** SWR in React Native: revalidate when the app comes back to the
 * foreground (the browser's "focus"). */
const swrConfig = {
  provider: () => new Map(),
  isVisible: () => AppState.currentState === "active",
  isOnline: () => true,
  initFocus(callback: () => void) {
    let last: string = AppState.currentState ?? "active";
    const sub = AppState.addEventListener("change", (next) => {
      if (last.match(/inactive|background/) && next === "active") callback();
      last = next;
    });
    return () => sub.remove();
  },
  initReconnect: () => () => undefined,
};

/** The signed-in app: its tabs (the web's phone tab bar, DESIGN.md §4 / §15).
 * Rules join in M9; a tab is never a dead link. */
export default function AppLayout() {
  const { status, currentTenantId } = useAuth();
  if (status !== "authenticated") return <Redirect href="/sign-in" />;

  return (
    // One cache per workspace: switching workspace starts empty, so nothing
    // from the previous one shows (the web clears its cache the same way).
    <SWRConfig key={currentTenantId ?? "none"} value={swrConfig}>
      <RealtimeProvider>
        <AppTabs />
      </RealtimeProvider>
    </SWRConfig>
  );
}

/** The tabs, inside the workspace's cache (the Alerts badge reads it). */
function AppTabs() {
  const theme = useTheme();
  const { unread } = useNotificationSummary();
  return (
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.ink,
          headerTitleStyle: { fontFamily: font.semibold, fontSize: text.section.fontSize },
          headerShadowVisible: false,
          tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.inkMuted,
          tabBarLabelStyle: { fontFamily: font.medium, fontSize: text.micro.fontSize },
          sceneStyle: { backgroundColor: theme.canvas },
        }}
      >
        <Tabs.Screen
          name="dashboards"
          options={{ title: "Dashboards", headerShown: false, tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="devices"
          options={{ title: "Devices", headerShown: false, tabBarIcon: ({ color, size }) => <Cpu color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="alerts"
          options={{
            title: "Alerts",
            headerShown: false,
            tabBarIcon: ({ color, size }) => <Bell color={color} size={size} />,
            // The unread count, as on the web's tab bar.
            tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.statusError, color: theme.onAccent, fontFamily: font.semibold, fontSize: text.micro.fontSize },
          }}
        />
        <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color, size }) => <Menu color={color} size={size} /> }} />
      </Tabs>
  );
}
