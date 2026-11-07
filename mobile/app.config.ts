import type { ExpoConfig } from "expo/config";

// The IO Driven app (Android first; iOS builds from the same code later).
// EXPO_PUBLIC_API_URL is set per build profile in eas.json, or in mobile/.env
// for a local run (see README.md).
const config: ExpoConfig = {
  name: "IO Driven",
  slug: "iodriven",
  scheme: "iodriven",
  version: "0.4.3",
  orientation: "portrait",
  // The IO Driven mark (docs/design/io-driven-mark.png): full-bleed for iOS
  // and older Android, adaptive layers (and a monochrome one for themed icons)
  // for Android 8+.
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  android: {
    package: "tech.iodriven.app",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-foreground.png",
      backgroundImage: "./assets/adaptive-background.png",
      monochromeImage: "./assets/adaptive-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // Device labels (docs/ble-provisioning.md): https://iodriven.tech/d/<id>
    // opens here once the site's assetlinks.json lists the signing key
    // (ANDROID_APP_CERT_SHA256); until then Android asks, or opens the browser.
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "iodriven.tech", pathPrefix: "/d/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  ios: {
    bundleIdentifier: "tech.iodriven.app",
    supportsTablet: false,
  },
  plugins: [
    "expo-router",
    "expo-font",
    // The mark on the canvas colour, light or dark (DESIGN.md §3).
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 120, backgroundColor: "#f7f7f8", dark: { backgroundColor: "#0f1014" } },
    ],
    // The scanner reads device labels and Wi-Fi setup QRs; no audio, no photos.
    [
      "expo-camera",
      {
        cameraPermission: "IO Driven uses the camera to read a device's label or its Wi-Fi setup QR.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // Wi-Fi setup over Bluetooth (docs/ble-provisioning.md). BLE only, and the
    // scan never derives location, so Android 12+ asks for Nearby devices only.
    [
      "@orbital-systems/react-native-esp-idf-provisioning",
      {
        transport: "ble",
        neverForLocation: true,
        bluetoothAlwaysPermission: "IO Driven uses Bluetooth to set up a board's Wi-Fi.",
        locationWhenInUsePermission: false,
        localNetworkPermission: false,
      },
    ],
    "./plugins/with-upload-signing",
    // R8 keep rules for code found by name: the QR scanner and Bluetooth setup.
    "./plugins/with-proguard-rules",
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
