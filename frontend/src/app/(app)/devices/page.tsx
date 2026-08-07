"use client";

import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

function DeviceLatestMetrics({ deviceId }: { deviceId: string }) {
  const { data } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`);

  // Only render metrics this device has actually reported — never a placeholder
  // zero/empty slot for one it has never sent (UX_UI_Description.md §3).
  if (!data || data.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 text-sm text-ink-muted">
      {data.map((m) => (
        <span key={m.metric}>
          {m.metric}: <span className="text-ink">{m.value}</span>
        </span>
      ))}
    </div>
  );
}

export default function DevicesPage() {
  const { data: devices, error, isLoading, mutate } = useApiSWR<DeviceResponse[]>("/devices");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Devices</h1>
        <div className="flex items-center gap-3">
          <Link href="/devices/catalog" className="text-sm text-ink-muted hover:text-ink">
            Manage catalog
          </Link>
          <Link
            href="/devices/new"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            Add device
          </Link>
        </div>
      </div>

      {isLoading && <LoadingSkeleton rows={4} rowClassName="h-16" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load devices."}
          onRetry={() => void mutate()}
        />
      )}

      {devices && devices.length === 0 && (
        <EmptyState
          title="No devices yet"
          description="Register your first device to start seeing live data."
          action={
            <Link href="/devices/new" className="text-sm text-accent">
              Add your first device →
            </Link>
          }
        />
      )}

      {devices && devices.length > 0 && (
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li key={d.id}>
              <Link
                href={`/devices/${d.id}`}
                className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-raised"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{d.name}</span>
                  <ConnectionBadge state={d.connection_state} />
                </div>
                <DeviceLatestMetrics deviceId={d.id} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
