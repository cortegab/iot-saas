import { deviceIdFromLink } from "@iodriven/shared/device-link";
import { parseProvisioningQr } from "@iodriven/shared/provisioning-qr";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { scannedQr } from "@/provisioning/scanned";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

/** Scan a device's QR (DESIGN.md §15): a **device label** opens the device; a
 * **Wi-Fi setup QR** (the provisioning QR from Connect) starts setting up the
 * board's Wi-Fi. Anything else says what it isn't and keeps scanning. */
export default function Scan() {
  const theme = useTheme();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [unknown, setUnknown] = useState(false);
  // The camera reports the same code many times a second: act once.
  const handled = useRef(false);
  const lastUnknown = useRef("");

  function onScanned({ data }: BarcodeScanningResult) {
    if (handled.current) return;
    const deviceId = deviceIdFromLink(data);
    if (deviceId) {
      handled.current = true;
      router.replace({ pathname: "/devices/[deviceId]", params: { deviceId } });
      return;
    }
    const qr = parseProvisioningQr(data);
    if (qr) {
      handled.current = true;
      scannedQr.set(qr);
      router.replace("/devices/wifi");
      return;
    }
    if (data !== lastUnknown.current) {
      lastUnknown.current = data;
      setUnknown(true);
    }
  }

  const header = <Stack.Screen options={{ title: "Scan a QR" }} />;

  if (!permission) return header;
  if (!permission.granted) {
    return (
      <SafeAreaView edges={["bottom"]} style={styles.ask}>
        {header}
        <Text size="section" weight="semibold">
          Scan with the camera
        </Text>
        <Text color="inkMuted">
          IO Driven uses the camera only to read a device&apos;s label or its Wi-Fi setup QR. Nothing is recorded.
        </Text>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <>
            <Text color="inkMuted">Camera access is off for IO Driven. Turn it on in the phone&apos;s Settings.</Text>
            <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
          </>
        )}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.page}>
      {header}
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScanned} />
      <View style={styles.frame} pointerEvents="none">
        <View style={[styles.window, { borderColor: theme.onAccent }]} />
      </View>
      <SafeAreaView edges={["bottom"]} style={styles.bottom} pointerEvents="none">
        <View style={[styles.note, { backgroundColor: theme.surface }]}>
          {unknown ? (
            <Text weight="medium">This QR isn&apos;t an IO Driven label or a Wi-Fi setup QR.</Text>
          ) : (
            <Text weight="medium">Point at a device&apos;s label or its Wi-Fi setup QR</Text>
          )}
          <Text size="meta" color="inkMuted">
            A label opens the device. The setup QR, from Connect on the web, sets up the board&apos;s Wi-Fi.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#000" },
  ask: { flex: 1, padding: 24, gap: 14, justifyContent: "center" },
  frame: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  window: { width: 240, height: 240, borderWidth: 3, borderRadius: radius.lg },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16 },
  note: { borderRadius: radius.lg, padding: 14, gap: 4 },
});
