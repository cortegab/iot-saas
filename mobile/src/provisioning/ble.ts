import { ESPProvisionManager, ESPSecurity, ESPTransport, type ESPDevice } from "@orbital-systems/react-native-esp-idf-provisioning";
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

/** Opens the board's provisioning session: a fresh Bluetooth search for the
 * board by its advertised name, then the secure handshake with the QR's code.
 * The search also clears the native module's list of boards: without it, a
 * second attempt reconnects to the board remembered from the first one, and
 * waits 30 s on a board that may no longer be advertising. */
export async function connectBoard(qr: ProvisioningQr): Promise<ESPDevice> {
  const security = qr.security === 2 ? ESPSecurity.secure2 : qr.security === 1 ? ESPSecurity.secure : ESPSecurity.unsecure;
  const found = await ESPProvisionManager.searchESPDevices(qr.name, ESPTransport.ble, security);
  const device = found.find((d) => d.name === qr.name);
  if (!device) throw new Error("Device not found.");
  await device.connect(qr.pop, null, qr.username);
  return device;
}
