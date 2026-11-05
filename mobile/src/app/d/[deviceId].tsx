import { Redirect, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";

/** A device label's link, `https://iodriven.tech/d/<id>` (an Android App
 * Link; the web redirects the same path): opens the device, after sign-in if
 * needed. */
export default function DeviceLabelLink() {
  const { deviceId } = useLocalSearchParams<{ deviceId: string }>();
  const { status } = useAuth();
  const target = `/devices/${encodeURIComponent(deviceId)}`;
  if (status === "authenticated") return <Redirect href={{ pathname: "/devices/[deviceId]", params: { deviceId } }} />;
  return <Redirect href={{ pathname: "/sign-in", params: { next: target } }} />;
}
