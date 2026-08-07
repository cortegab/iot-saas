"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];
type Widget = components["schemas"]["Widget"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type WidgetType = Widget["type"];

const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  value_card: "Value card",
  trend_chart: "Trend chart",
  device_status: "Device status",
  actuator_control: "Actuator control",
  gauge: "Gauge",
};

function needsMetric(type: WidgetType): boolean {
  return type === "value_card" || type === "trend_chart" || type === "gauge";
}

function needsRange(type: WidgetType): boolean {
  return type === "gauge";
}

type NewWidget = Omit<Widget, "x" | "y">;

function AddWidgetForm({ onAdd }: { onAdd: (widget: NewWidget) => void }) {
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const [type, setType] = useState<WidgetType>("value_card");
  const [deviceId, setDeviceId] = useState("");
  const [metric, setMetric] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("100");

  const { data: latest } = useApiSWR<TelemetryLatestResponse[]>(
    deviceId ? `/devices/${deviceId}/latest` : null,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!deviceId) return;
    onAdd({
      id: crypto.randomUUID(),
      type,
      w: 4,
      h: 4,
      device_id: deviceId,
      metric: needsMetric(type) ? metric || null : null,
      min: needsRange(type) ? Number(min) : null,
      max: needsRange(type) ? Number(max) : null,
    });
    setMetric("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-4">
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Widget type
        <select
          value={type}
          onChange={(e) => setType(e.target.value as WidgetType)}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        >
          {(Object.keys(WIDGET_TYPE_LABELS) as WidgetType[]).map((t) => (
            <option key={t} value={t}>
              {WIDGET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Device
        <select
          required
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            setMetric("");
          }}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        >
          <option value="" disabled>
            Choose a device…
          </option>
          {devices?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {needsMetric(type) && (
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Metric
          <select
            required
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            disabled={!deviceId}
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink disabled:opacity-60"
          >
            <option value="" disabled>
              {deviceId ? "Choose a metric…" : "Pick a device first"}
            </option>
            {latest?.map((m) => (
              <option key={m.metric} value={m.metric}>
                {m.metric}
              </option>
            ))}
          </select>
        </label>
      )}
      {needsRange(type) && (
        <>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Min
            <input
              type="number"
              required
              value={min}
              onChange={(e) => setMin(e.target.value)}
              className="w-20 rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Max
            <input
              type="number"
              required
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className="w-20 rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
            />
          </label>
        </>
      )}
      <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">
        Add widget
      </button>
    </form>
  );
}

export default function DashboardDetailPage() {
  const params = useParams<{ dashboardId: string }>();
  const dashboardId = params.dashboardId;
  const router = useRouter();
  const api = useApi();

  const { data, error, isLoading } = useApiSWR<DashboardResponse>(`/dashboards/${dashboardId}`);

  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed local editable state once per dashboard — not on every background
  // SWR revalidation, so an in-progress drag/edit is never clobbered by a
  // refetch of data we already have.
  useEffect(() => {
    if (data) {
      setWidgets((prev) => (prev === null ? data.layout : prev));
      setName((prev) => (prev === "" ? data.name : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  async function saveLayout(next: Widget[]) {
    setWidgets(next);
    setSaveError(null);
    try {
      await api.patch(`/dashboards/${dashboardId}`, { layout: next });
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "Couldn't save the layout.");
    }
  }

  async function saveName() {
    setSaveError(null);
    try {
      await api.patch(`/dashboards/${dashboardId}`, { name });
      setRenaming(false);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "Couldn't rename this dashboard.");
    }
  }

  async function deleteDashboard() {
    if (!data || !confirm(`Delete "${data.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/dashboards/${dashboardId}`);
      router.replace("/dashboards");
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "Couldn't delete this dashboard.");
    }
  }

  if (isLoading || widgets === null) return <LoadingSkeleton rows={3} rowClassName="h-24" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load this dashboard."}
      />
    );
  }
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {renaming ? (
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border bg-surface-raised px-2 py-1 text-lg text-ink"
            />
            <button type="button" onClick={() => void saveName()} className="rounded-md bg-accent px-3 py-1 text-sm text-white">
              Save
            </button>
            <button type="button" onClick={() => setRenaming(false)} className="text-sm text-ink-muted">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-ink">{data.name}</h1>
            <button
              type="button"
              onClick={() => {
                setName(data.name);
                setRenaming(true);
              }}
              className="text-sm text-accent"
            >
              Rename
            </button>
          </div>
        )}
        <button type="button" onClick={() => void deleteDashboard()} className="text-sm text-status-error">
          Delete dashboard
        </button>
      </div>

      {saveError && <ErrorState message={saveError} />}

      <AddWidgetForm
        onAdd={(widget) => {
          // "Place at the bottom": react-grid-layout's own convention for this
          // is y: Infinity, but that only works passed as a live JS object —
          // JSON.stringify(Infinity) is `null`, which the backend's
          // Widget.y: int rejects with a 422. Compute a real number instead.
          const y = widgets.length === 0 ? 0 : Math.max(...widgets.map((w) => w.y + w.h));
          void saveLayout([...widgets, { ...widget, x: 0, y }]);
        }}
      />

      {widgets.length === 0 ? (
        <EmptyState
          title="This dashboard is empty"
          description="Add your first widget above to start seeing live data here."
        />
      ) : (
        <DashboardGrid
          widgets={widgets}
          onLayoutChange={(updated) => void saveLayout(updated)}
          onRemoveWidget={(id) => void saveLayout(widgets.filter((w) => w.id !== id))}
        />
      )}
    </div>
  );
}
