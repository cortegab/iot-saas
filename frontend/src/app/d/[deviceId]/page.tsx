import { redirect } from "next/navigation";

/** A device label's link (`/d/<id>`, docs/ble-provisioning.md): opens the
 * device page. The IO Driven app catches the same link on Android. */
export default async function DeviceLabelLink({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  redirect(`/devices/${encodeURIComponent(deviceId)}`);
}
