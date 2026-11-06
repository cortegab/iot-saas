/** Android App Links (docs/ble-provisioning.md, "Device label"): lets the
 * iodriven app open `/d/<id>` links itself. ANDROID_APP_CERT_SHA256 lists the
 * signing certificates' SHA-256 fingerprints, comma-separated (the Play app
 * signing key and, for sideloaded builds, the upload key). Unset, the list is
 * empty and links open in the browser. */
export const dynamic = "force-dynamic";

export function GET() {
  const fingerprints = (process.env.ANDROID_APP_CERT_SHA256 ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  const body = fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: "tech.iodriven.app", sha256_cert_fingerprints: fingerprints },
        },
      ]
    : [];
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
