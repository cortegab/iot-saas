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
import { font, text } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [loaded, error] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold });

  // Fonts failing to load isn't fatal: the system face stands in.
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!loaded && !error) return null;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.ink,
          headerTitleStyle: { fontFamily: font.semibold, fontSize: text.section.fontSize },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.canvas },
        }}
      />
    </>
  );
}
