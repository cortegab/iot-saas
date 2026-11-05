/** The provisioning QR (docs/ble-provisioning.md, "QR payload"): Espressif's
 * JSON, as the ESP BLE Provisioning app and the iodriven app scan it. Its
 * `pop` is the device's MQTT password, so it is a secret. */

/** The name the phone app lists: the device name in printable ASCII (accents
 * dropped), at most 29 bytes — the BLE limit. The sketch's PROV_NAME and the
 * QR's "name" both come from here, so they always match. */
export function provName(deviceName: string): string {
  const ascii = deviceName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (ascii || "iot-device").slice(0, 29).trim();
}

/** The QR payload the ESP BLE Provisioning app scans (docs/ble-provisioning.md).
 * `security` is always explicit: the app assumes 2 when it's missing. */
export function provisioningPayload(p: { name: string; username: string; password: string; security: 1 | 2 }): string {
  const body =
    p.security === 2
      ? { ver: "v1", name: p.name, username: p.username, pop: p.password, transport: "ble", network: "wifi", security: 2 }
      : { ver: "v1", name: p.name, pop: p.password, transport: "ble", network: "wifi", security: 1 };
  return JSON.stringify(body);
}

export interface ProvisioningQr {
  /** The board's BLE name (`provName` of the device name when it was flashed). */
  name: string;
  /** Proof of possession (Security 1) or SRP password (Security 2): the MQTT password. */
  pop: string;
  /** SRP username, Security 2 only: the device id. */
  username: string | null;
  security: 0 | 1 | 2;
}

/** A scanned provisioning QR, or null when the text isn't one (or is for a
 * transport the app doesn't speak: SoftAP). `security` defaults to 2, as in
 * Espressif's apps. */
export function parseProvisioningQr(text: string): ProvisioningQr | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const o = body as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name) return null;
  if (o.transport !== undefined && o.transport !== "ble") return null;
  const security = o.security === undefined ? 2 : Number(o.security);
  if (security !== 0 && security !== 1 && security !== 2) return null;
  const pop = typeof o.pop === "string" ? o.pop : "";
  if (security !== 0 && !pop) return null;
  const username = typeof o.username === "string" && o.username ? o.username : null;
  if (security === 2 && !username) return null;
  return { name: o.name, pop, username, security };
}
