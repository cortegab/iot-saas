"use client";

import { Badge } from "@/components/ui/Badge";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { DeviceLink, useWidgetDevice } from "@/components/dashboards/widget-common";
import { DEVICE_STATUS, deviceStatusKey } from "@/lib/device-status";
import { timeAgo } from "@/lib/time-ago";

export function DeviceStatusWidget({ deviceId }: { deviceId: string }) {
  const { device, isLoading } = useWidgetDevice(deviceId);
  const st = device ? DEVICE_STATUS[deviceStatusKey(device)] : null;
  return (
    <WidgetCard title="Device status" subtitle={<DeviceLink device={device} />}>
      {isLoading || !device || !st ? (
        <LoadingSkeleton rows={1} rowClassName="h-8" />
      ) : (
        <div className="flex h-full flex-col justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone} shape={st.shape} label={st.label} />
            <span className="text-[13px] text-ink-muted">
              {device.connection_state === "never_connected" ? "Waiting for first message" : `Last seen ${timeAgo(device.last_seen_at)}`}
            </span>
          </div>
          {(device.rssi != null || device.battery_pct != null || device.fw_version != null) && (
            <span className="flex flex-wrap gap-x-3 text-[11.5px] text-ink-muted">
              {device.rssi != null && <span>{device.rssi} dBm</span>}
              {device.battery_pct != null && <span>{device.battery_pct}% battery</span>}
              {device.fw_version != null && <span>fw {device.fw_version}</span>}
            </span>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
