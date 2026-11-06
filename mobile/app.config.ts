import type { ExpoConfig } from "expo/config";

// The iodriven app (Android first; iOS builds from the same code later).
// EXPO_PUBLIC_API_URL is set per build profile in eas.json, or in mobile/.env
// for a local run (see README.md).
const config: ExpoConfig = {
  name: "iodriven",
  slug: "iodriven",
  scheme: "iodriven",
  version: "0.2.1",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  android: {
    package: "tech.iodriven.app",
    predictiveBackGestureEnabled: false,
  },
  ios: {
    bundleIdentifier: "tech.iodriven.app",
    supportsTablet: false,
  },
  plugins: ["expo-router", "expo-font", "./plugins/with-upload-signing"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
