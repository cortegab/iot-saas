import type { components } from "@iodriven/shared/api";
import { provName, type ProvisioningQr } from "@iodriven/shared/provisioning-qr";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** The provisioning QR just scanned, held in memory only (its `pop` is the
 * device's broker password) between the scanner and the Wi-Fi setup screen.
 * Nothing is written to storage or put in a route. */
let current: ProvisioningQr | null = null;

export const scannedQr = {
  set(qr: ProvisioningQr) {
    current = qr;
  },
  get(): ProvisioningQr | null {
    return current;
  },
  clear() {
    current = null;
  },
};

/** The workspace devices a provisioning QR can belong to: the board
 * advertises `provName` of the name it was flashed with, so a device renamed
 * since, or two names that truncate alike, can match none or several. */
export function devicesForQr(devices: DeviceResponse[], qr: ProvisioningQr): DeviceResponse[] {
  // Security 2 carries the device id as the SRP username: an exact match.
  if (qr.username) {
    const byId = devices.filter((d) => d.id === qr.username);
    if (byId.length) return byId;
  }
  return devices.filter((d) => provName(d.name) === qr.name);
}
