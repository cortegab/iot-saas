import type { ExpoConfig } from "expo/config";

// The iodriven app (Android first; iOS builds from the same code later).
// EXPO_PUBLIC_API_URL is set per build profile in eas.json, or in mobile/.env
// for a local run (see README.md).
const config: ExpoConfig = {
  name: "iodriven",
  slug: "iodriven",
  scheme: "iodriven",
  version: "0.3.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  android: {
    package: "tech.iodriven.app",
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
    // The scanner reads device labels and Wi-Fi setup QRs; no audio, no photos.
    [
      "expo-camera",
      {
        cameraPermission: "iodriven uses the camera to read a device's label or its Wi-Fi setup QR.",
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
        bluetoothAlwaysPermission: "iodriven uses Bluetooth to set up a board's Wi-Fi.",
        locationWhenInUsePermission: false,
        localNetworkPermission: false,
      },
    ],
    "./plugins/with-upload-signing",
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
