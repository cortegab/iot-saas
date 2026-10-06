"use client";

import { useParams } from "next/navigation";
import { ConnectFlow } from "@/components/devices/ConnectFlow";

/** /devices/[deviceId]/connect — the 4-step connect flow (DESIGN.md §8). */
export default function ConnectDevicePage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  return <ConnectFlow deviceId={deviceId} />;
}
