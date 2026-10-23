"use client";

import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { DeviceLink, useWidgetDevice } from "@/components/dashboards/widget-common";

export function ActuatorControlWidget({ deviceId }: { deviceId: string }) {
  const { device, isLoading } = useWidgetDevice(deviceId);
  const online = device?.connection_state === "online";
  return (
    <WidgetCard title="Controls" subtitle={<DeviceLink device={device} />}>
      {isLoading || !device ? (
        <LoadingSkeleton rows={1} rowClassName="h-16" />
      ) : (
        <div className="flex flex-col gap-2">
          {/* Said once, as on the device's Controls tab (DESIGN.md §8). */}
          {!online && device.status === "active" && (
            <p className="text-xs text-status-pending">Offline. Commands wait in its desired state and apply when it reconnects.</p>
          )}
          <ActuatorControl
            deviceId={deviceId}
            deviceOnline={online}
            deviceDisabled={device.status !== "active"}
            catalogEntryId={device.catalog_entry_id}
          />
        </div>
      )}
    </WidgetCard>
  );
}
