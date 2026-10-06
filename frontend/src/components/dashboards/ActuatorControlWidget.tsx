"use client";

import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { DeviceLink, useWidgetDevice } from "@/components/dashboards/widget-common";

export function ActuatorControlWidget({ deviceId }: { deviceId: string }) {
  const { device, isLoading } = useWidgetDevice(deviceId);
  return (
    <WidgetCard title="Controls" subtitle={<DeviceLink device={device} />}>
      {isLoading || !device ? (
        <LoadingSkeleton rows={1} rowClassName="h-16" />
      ) : (
        <ActuatorControl deviceId={deviceId} deviceOnline={device.connection_state === "online"} catalogEntryId={device.catalog_entry_id} />
      )}
    </WidgetCard>
  );
}
