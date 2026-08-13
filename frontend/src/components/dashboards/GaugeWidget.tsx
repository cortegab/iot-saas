"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

// A semicircular arc, drawn as a single SVG path from 180° (left) to 0°
// (right) through the top — the classic gauge sweep.
const RADIUS = 40;
const CENTER = { x: 50, y: 50 };
const ARC_LENGTH = Math.PI * RADIUS; // half the circle's circumference

function polarToCartesian(angleDeg: number): { x: number; y: number } {
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER.x + RADIUS * Math.cos(angleRad),
    y: CENTER.y - RADIUS * Math.sin(angleRad),
  };
}

function arcPath(): string {
  const start = polarToCartesian(180);
  const end = polarToCartesian(0);
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 0 1 ${end.x} ${end.y}`;
}

export function GaugeWidget({
  deviceId,
  metric,
  min,
  max,
  onRemove,
}: {
  deviceId: string;
  metric: string | null;
  min: number | null;
  max: number | null;
  onRemove?: () => void;
}) {
  const { data: device } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  // A fallback, not the primary freshness mechanism — useRealtime revalidates
  // this same key the moment a telemetry message for this device arrives.
  const { data: latest, isLoading } = useApiSWR<TelemetryLatestResponse[]>(
    `/devices/${deviceId}/latest`,
    { refreshInterval: 20_000 },
  );

  const reading = latest?.find((r) => r.metric === metric);
  const lo = min ?? 0;
  const hi = max ?? 100;
  const fraction =
    reading && hi > lo ? Math.min(1, Math.max(0, (reading.value - lo) / (hi - lo))) : 0;

  return (
    <WidgetCard title={device?.name ?? "Gauge"} onRemove={onRemove}>
      <div className="flex h-full flex-col items-center justify-between">
        {isLoading ? (
          <LoadingSkeleton rows={1} rowClassName="h-16" />
        ) : !metric || !reading ? (
          <EmptyState title="No reading yet" description={metric ? undefined : "No metric configured."} />
        ) : (
          <svg viewBox="0 0 100 60" className="w-full max-w-[180px]">
            <path
              d={arcPath()}
              fill="none"
              className="text-border"
              stroke="currentColor"
              strokeWidth={8}
              strokeLinecap="round"
            />
            <path
              d={arcPath()}
              fill="none"
              className="text-accent"
              stroke="currentColor"
              strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={ARC_LENGTH}
              strokeDashoffset={ARC_LENGTH * (1 - fraction)}
            />
            <text
              x={CENTER.x}
              y={CENTER.y - 4}
              textAnchor="middle"
              className="fill-ink text-[16px] font-semibold"
            >
              {reading.value}
            </text>
            <text
              x={CENTER.x}
              y={CENTER.y + 10}
              textAnchor="middle"
              className="fill-ink-muted text-[8px] uppercase tracking-wide"
            >
              {metric}
            </text>
          </svg>
        )}
        {device && (
          <div className="mt-2">
            <ConnectionBadge state={device.connection_state} />
          </div>
        )}
      </div>
    </WidgetCard>
  );
}
