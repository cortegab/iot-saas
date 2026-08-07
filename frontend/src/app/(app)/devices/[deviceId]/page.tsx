"use client";

import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuthContext } from "@/lib/auth-context";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { ApiRequestError } from "@/lib/api-client";
import { DeviceTrendChart } from "@/components/chart/DeviceTrendChart";
import type { ChartThreshold } from "@/components/chart/TrendChart";
import { RuleList } from "@/components/rules/RuleList";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { CommandHistory } from "@/components/actuators/CommandHistory";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];

function CurrentReadings({ deviceId }: { deviceId: string }) {
  const { data, error, isLoading } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`);

  if (isLoading) return <LoadingSkeleton rows={2} rowClassName="h-10" />;
  if (error) return <ErrorState message="Couldn't load current readings." />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No readings yet"
        description="Once this device publishes telemetry, its latest values appear here."
      />
    );
  }

  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {data.map((m) => (
        <div key={m.metric} className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">{m.metric}</dt>
          <dd className="text-lg font-semibold text-ink">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// MQTT topics are built from slugs, not display names — a device's slug is
// fixed at creation and never changes on rename, so this is the one place
// that reliably answers "what do I actually publish to?" after onboarding.
function MqttTopicInfo({ deviceSlug }: { deviceSlug: string }) {
  const { memberships, currentTenantId } = useAuthContext();
  const [copied, setCopied] = useState(false);
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug;

  if (!tenantSlug) return null;

  const subtree = `${tenantSlug}/${deviceSlug}`;

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-ink-muted">MQTT topic</p>
      <p className="mt-1 font-mono text-sm text-ink">{subtree}/&lt;metric&gt;</p>
      <p className="mt-1 text-xs text-ink-muted">
        e.g. <span className="font-mono">{subtree}/temperature</span> — commands publish to{" "}
        <span className="font-mono">{subtree}/cmd/&lt;actuator&gt;</span>
      </p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(subtree).then(() => setCopied(true));
        }}
        className="mt-2 text-xs text-accent"
      >
        {copied ? "Copied" : "Copy topic prefix"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function DeviceDetailPage() {
  const params = useParams<{ deviceId: string }>();
  const deviceId = params.deviceId;
  const router = useRouter();
  const api = useApi();

  const { data: device, error, isLoading, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  // Same SWR key RuleList/ActuatorControl fetch — shared cache, one request.
  const { data: rules } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);

  const thresholdsByMetric = useMemo(() => {
    const map: Record<string, ChartThreshold[]> = {};
    for (const rule of rules ?? []) {
      if (!rule.enabled) continue;
      (map[rule.metric] ??= []).push({ value: rule.threshold, label: `${rule.operator} ${rule.threshold}` });
    }
    return map;
  }, [rules]);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<DeviceCreateResponse["credential"] | null>(null);

  if (isLoading) return <LoadingSkeleton rows={5} rowClassName="h-14" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load this device."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!device) return null;

  async function toggleStatus() {
    setBusy(true);
    setActionError(null);
    try {
      const next = device!.status === "active" ? "disabled" : "active";
      await api.patch(`/devices/${deviceId}`, { status: next });
      await mutate();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't update status.");
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    setBusy(true);
    setActionError(null);
    try {
      await api.patch(`/devices/${deviceId}`, { name });
      await mutate();
      setRenaming(false);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't rename device.");
    } finally {
      setBusy(false);
    }
  }

  async function rotateCredential() {
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.post<DeviceCreateResponse>(`/devices/${deviceId}/rotate-credential`);
      setRotated(result.credential);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't rotate credential.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDevice() {
    if (!confirm(`Delete ${device!.name}? This cannot be undone.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(`/devices/${deviceId}`);
      router.replace("/devices");
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete device.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">{device.name}</h1>
        <ConnectionBadge state={device.connection_state} />
      </div>

      <MqttTopicInfo deviceSlug={device.slug} />

      <Section title="Current readings">
        <CurrentReadings deviceId={deviceId} />
      </Section>

      <Section title="Trend chart">
        <DeviceTrendChart deviceId={deviceId} thresholdsByMetric={thresholdsByMetric} />
      </Section>

      <Section title="Rules">
        <RuleList deviceId={deviceId} />
      </Section>

      <Section title="Actuator controls">
        <ActuatorControl deviceId={deviceId} deviceOnline={device.connection_state === "online"} />
        <CommandHistory deviceId={deviceId} />
      </Section>

      <hr className="border-border" />

      <Section title="Settings">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          {actionError && <ErrorState message={actionError} />}

          <div>
            <span className="text-xs uppercase tracking-wide text-ink-muted">Name</span>
            {renaming ? (
              <div className="mt-1 flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-ink"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveName()}
                  className="rounded-md bg-accent px-3 py-1 text-sm text-white"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setRenaming(false)}
                  className="rounded-md px-3 py-1 text-sm text-ink-muted"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-3">
                <span className="text-sm text-ink">{device.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setName(device.name);
                    setRenaming(true);
                  }}
                  className="text-sm text-accent"
                >
                  Rename
                </button>
              </div>
            )}
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-ink-muted">Status</span>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-sm text-ink">{device.status}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleStatus()}
                className="text-sm text-accent disabled:opacity-60"
              >
                {device.status === "active" ? "Disable" : "Enable"}
              </button>
            </div>
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-ink-muted">Credential</span>
            {rotated ? (
              <div className="mt-1 rounded-md border border-status-pending/40 bg-status-pending/10 p-3 text-sm">
                <p className="font-medium text-ink">Copy this now — it will not be shown again.</p>
                <p className="mt-1 font-mono text-ink">{rotated.username}</p>
                <p className="font-mono text-ink">{rotated.password}</p>
              </div>
            ) : (
              <div className="mt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void rotateCredential()}
                  className="text-sm text-accent disabled:opacity-60"
                >
                  Rotate credential
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteDevice()}
              className="text-sm text-status-error disabled:opacity-60"
            >
              Delete device
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
