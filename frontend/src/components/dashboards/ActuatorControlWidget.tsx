"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

export function ActuatorControlWidget({
  deviceId,
  onRemove,
}: {
  deviceId: string;
  onRemove?: () => void;
}) {
  const { data: device, isLoading } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);

  return (
    <WidgetCard title={device?.name ?? "Actuator"} onRemove={onRemove}>
      {isLoading || !device ? (
        <LoadingSkeleton rows={1} rowClassName="h-16" />
      ) : (
        <ActuatorControl
          deviceId={deviceId}
          deviceOnline={device.connection_state === "online"}
          catalogEntryId={device.catalog_entry_id}
        />
      )}
    </WidgetCard>
  );
}
