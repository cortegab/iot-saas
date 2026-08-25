"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuthContext } from "@/lib/auth-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { DeviceTrendChart } from "@/components/chart/DeviceTrendChart";
import type { ChartThreshold } from "@/components/chart/TrendChart";
import { RuleList } from "@/components/rules/RuleList";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { CommandHistory } from "@/components/actuators/CommandHistory";
import { leafPredicates, parseAction } from "@/components/rules/RuleSummary";
import { buildSketch } from "@/lib/firmware-sketch";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

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
        <Card key={m.metric} padding="sm">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">{m.metric}</dt>
          <dd className="text-lg font-semibold text-ink">{m.value}</dd>
        </Card>
      ))}
    </dl>
  );
}

function formatCommandValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  return String(value);
}

/** Read-only actuator states for the Overview tab — the Actuators tab has the
 * interactive controls; this is just "what's the state right now" at a
 * glance, derived the same way ActuatorControl finds its actuator list
 * (rule actions), just without the send-command affordance. */
function ActuatorStateSummary({ deviceId }: { deviceId: string }) {
  const { data: rules, isLoading: rulesLoading } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  const { data: commands } = useApiSWR<CommandResponse[]>(`/devices/${deviceId}/commands`, {
    refreshInterval: 20_000,
  });

  const actuators = useMemo(() => {
    const set = new Set<string>();
    for (const rule of rules ?? []) {
      const action = parseAction(rule.action);
      if (action?.type === "actuator_command") set.add(action.actuator);
    }
    return Array.from(set);
  }, [rules]);

  if (rulesLoading) return <LoadingSkeleton rows={1} rowClassName="h-10" />;
  if (actuators.length === 0) return null;

  return (
    <dl className="flex flex-wrap gap-4">
      {actuators.map((actuator) => {
        const latest = commands?.find((c) => c.actuator === actuator);
        return (
          <Card key={actuator} padding="sm">
            <dt className="text-xs uppercase tracking-wide text-ink-muted">{actuator}</dt>
            <dd className="text-sm font-semibold text-ink">
              {latest ? formatCommandValue(latest.value) : "—"}
            </dd>
          </Card>
        );
      })}
    </dl>
  );
}

function TopicRow({ label, topic }: { label: string; topic: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="truncate font-mono text-sm text-ink">{topic}</p>
      </div>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(topic).then(() => setCopied(true))}
        className="shrink-0 text-xs text-accent"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// MQTT topics are built from slugs, not display names — a device's slug is
// fixed at creation and never changes on rename, so this is the one place
// that reliably answers "what do I actually publish to?" after onboarding.
// One row per catalog-declared metric/actuator; a "Legacy" device (no
// declarations) falls back to the generic placeholder pattern this page
// showed before the catalog existed.
function DeviceTopics({ device }: { device: DeviceResponse }) {
  const { memberships, currentTenantId } = useAuthContext();
  const { data: catalogEntry } = useApiSWR<CatalogEntryResponse>(`/catalog/${device.catalog_entry_id}`);
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug;

  if (!tenantSlug) return null;

  const subtree = `${tenantSlug}/${device.slug}`;
  const metrics = catalogEntry?.metrics ?? [];
  const actuators = catalogEntry?.actuators ?? [];

  if (metrics.length === 0 && actuators.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-muted">
          <span className="font-mono">{subtree}/&lt;metric&gt;</span> — commands publish to{" "}
          <span className="font-mono">{subtree}/cmd/&lt;actuator&gt;</span>
        </p>
        <TopicRow label="Topic prefix" topic={subtree} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {metrics.map((m) => (
        <TopicRow key={`metric-${m.name}`} label={`Telemetry — ${m.name}`} topic={`${subtree}/${m.name}`} />
      ))}
      {actuators.map((a) => (
        <div key={`actuator-${a.name}`} className="flex flex-col gap-1">
          <TopicRow
            label={`Command — ${a.name} (device subscribes)`}
            topic={`${subtree}/cmd/${a.name}`}
          />
          <TopicRow
            label={`Desired state — ${a.name} (device subscribes, retained)`}
            topic={`${subtree}/state/${a.name}`}
          />
          <TopicRow
            label={`Acknowledgement — ${a.name} (device publishes)`}
            topic={`${subtree}/ack/${a.name}`}
          />
        </div>
      ))}
    </div>
  );
}

// On-demand onboarding code, catalog-driven — unlike devices/new/page.tsx's
// FirmwareSketch, the credential is never available here (shown exactly once,
// at creation/rotation, never retrievable afterward), so buildSketch is
// called with credential: null and emits a placeholder instead.
function OnboardingCode({ device }: { device: DeviceResponse }) {
  const { memberships, currentTenantId } = useAuthContext();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data: catalogEntry } = useApiSWR<CatalogEntryResponse>(
    open ? `/catalog/${device.catalog_entry_id}` : null,
  );
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug;

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        Generate onboarding code
      </Button>
    );
  }

  const sketch = buildSketch({
    tenantSlug: tenantSlug ?? "",
    deviceSlug: device.slug,
    host: typeof window !== "undefined" ? window.location.hostname : "YOUR_SERVER_HOST",
    tls: typeof window !== "undefined" && window.location.protocol === "https:",
    metrics: catalogEntry?.metrics ?? [],
    actuators: catalogEntry?.actuators ?? [],
    credential: null,
  });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-muted">
        Credentials aren&apos;t included — paste them in after rotating a credential above.
      </p>
      <pre className="max-h-80 overflow-auto rounded-md bg-surface-raised p-3 text-xs text-ink">
        <code>{sketch}</code>
      </pre>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigator.clipboard.writeText(sketch).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy sketch"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-muted">
          Close
        </button>
      </div>
    </div>
  );
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "metrics", label: "Metrics" },
  { id: "actuators", label: "Actuators" },
  { id: "rules", label: "Rules" },
  { id: "settings", label: "Settings" },
];

export default function DeviceDetailPage() {
  const params = useParams<{ deviceId: string }>();
  const deviceId = params.deviceId;
  const searchParams = useSearchParams();
  const api = useApi();

  const [tab, setTab] = useState(searchParams.get("tab") ?? "overview");

  const { data: device, error, isLoading, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  // Same SWR key RuleList/ActuatorControl fetch — shared cache, one request.
  const { data: rules } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);

  const thresholdsByMetric = useMemo(() => {
    const map: Record<string, ChartThreshold[]> = {};
    for (const rule of rules ?? []) {
      if (!rule.enabled) continue;
      for (const leaf of leafPredicates(rule.condition)) {
        (map[leaf.metric] ??= []).push({
          value: leaf.threshold,
          label: `${leaf.operator} ${leaf.threshold}`,
        });
      }
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={device.name}
        back={{ href: "/devices", label: "Devices" }}
        actions={<ConnectionBadge state={device.connection_state} />}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel id="overview" active={tab}>
        <div className="flex flex-col gap-6">
          <CurrentReadings deviceId={deviceId} />
          <DeviceTrendChart deviceId={deviceId} thresholdsByMetric={thresholdsByMetric} />
          <ActuatorStateSummary deviceId={deviceId} />
        </div>
      </TabPanel>

      <TabPanel id="metrics" active={tab}>
        <DeviceTrendChart deviceId={deviceId} thresholdsByMetric={thresholdsByMetric} />
      </TabPanel>

      <TabPanel id="actuators" active={tab}>
        <div className="flex flex-col gap-4">
          <ActuatorControl
            deviceId={deviceId}
            deviceOnline={device.connection_state === "online"}
            catalogEntryId={device.catalog_entry_id}
          />
          <CommandHistory deviceId={deviceId} />
        </div>
      </TabPanel>

      <TabPanel id="rules" active={tab}>
        <RuleList deviceId={deviceId} />
      </TabPanel>

      <TabPanel id="settings" active={tab}>
        <Card className="flex flex-col gap-4">
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
                <Button disabled={busy} onClick={() => void saveName()}>
                  Save
                </Button>
                <Button type="button" variant="secondary" onClick={() => setRenaming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-3">
                <span className="text-sm text-ink">{device.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setName(device.name);
                    setRenaming(true);
                  }}
                >
                  Rename
                </Button>
              </div>
            )}
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-ink-muted">Status</span>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-sm text-ink">{device.status}</span>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void toggleStatus()}>
                {device.status === "active" ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-ink-muted">Credential</span>
            {rotated ? (
              <div className="mt-1 rounded-xl border border-status-pending/40 bg-status-pending/10 p-3 text-sm">
                <p className="font-medium text-ink">Copy this now — it will not be shown again.</p>
                <p className="mt-1 font-mono text-ink">{rotated.username}</p>
                <p className="font-mono text-ink">{rotated.password}</p>
              </div>
            ) : (
              <div className="mt-1">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => void rotateCredential()}>
                  Rotate credential
                </Button>
              </div>
            )}
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-ink-muted">MQTT topics</span>
            <div className="mt-1">
              <DeviceTopics device={device} />
            </div>
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-ink-muted">Onboarding code</span>
            <div className="mt-1">
              <OnboardingCode device={device} />
            </div>
          </div>
        </Card>
      </TabPanel>
    </div>
  );
}
