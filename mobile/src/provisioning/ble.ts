import { ESPDevice, ESPSecurity, ESPTransport } from "@orbital-systems/react-native-esp-idf-provisioning";
import type { ProvisioningQr } from "@iodriven/shared/provisioning-qr";
import { PermissionsAndroid, Platform } from "react-native";

/** Bluetooth permissions for talking to the board. Android 12+ asks for
 * "Nearby devices" (scan is declared neverForLocation); Android 11 and older
 * need location to scan for Bluetooth devices. iOS asks on first use. */
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** Opens the board's provisioning session: finds it over Bluetooth by its
 * advertised name, then the secure handshake with the QR's code. */
export async function connectBoard(qr: ProvisioningQr): Promise<ESPDevice> {
  const security = qr.security === 2 ? ESPSecurity.secure2 : qr.security === 1 ? ESPSecurity.secure : ESPSecurity.unsecure;
  const device = new ESPDevice({ name: qr.name, transport: ESPTransport.ble, security });
  await device.connect(qr.pop, null, qr.username);
  return device;
}

