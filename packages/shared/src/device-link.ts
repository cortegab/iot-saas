/** The device label's link (docs/ble-provisioning.md, "Device label"):
 * `<web origin>/d/<device id>`. It names the device and carries no secret. The
 * web redirects it to the device page; the app opens it as an App Link. */
export function deviceLink(webOrigin: string, deviceId: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/d/${deviceId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The device id in a label link (any host, so a dev label works too), or null. */
export function deviceIdFromLink(text: string): string | null {
  const m = /^https?:\/\/[^/\s]+\/d\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(text.trim());
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}
