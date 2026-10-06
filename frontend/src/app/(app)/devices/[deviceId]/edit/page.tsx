"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** A device is edited in its page's Settings tab (DESIGN.md §7); this route
 * keeps old links working. */
export default function DeviceEditRedirect() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/devices/${deviceId}?tab=settings`);
  }, [router, deviceId]);
  return null;
}
