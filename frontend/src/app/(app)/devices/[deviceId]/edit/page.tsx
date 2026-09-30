"use client";

import { useParams } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { DeviceEditor } from "@/components/devices/DeviceEditor";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** The device editor as a full page (DESIGN.md §7 "Expand"), deep-linkable. */
export default function DeviceEditPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { data: device } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  return (
    <>
      <Breadcrumbs
        crumbs={[
          { label: "Devices", href: "/devices" },
          { label: device?.name ?? "Device", href: `/devices/${deviceId}` },
          { label: "Edit" },
        ]}
      />
      <DeviceEditor deviceId={deviceId} mode="page" dockHref={`/devices?edit=${deviceId}`} />
    </>
  );
}
