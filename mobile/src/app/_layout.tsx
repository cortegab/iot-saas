// One import per weight, so only the three faces in tokens.ts ship (the
// package index would bundle all 18).
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/theme/useTheme";

void SplashScreen.preventAutoHideAsync();

/** Keeps the splash up until the fonts are in and the stored session has been
 * resumed (or found missing), so nothing flashes the sign-in screen. */
function Root({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useAuth();
  const theme = useTheme();
  const ready = fontsReady && status !== "loading";
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.canvas } }} />;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const [loaded, error] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold });
  return (
    <AuthProvider>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {/* Fonts failing to load isn't fatal: the system face stands in. */}
      <Root fontsReady={loaded || !!error} />
    </AuthProvider>
  );
}
