"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuthContext } from "@/lib/auth-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric } from "@/components/ui/Metric";
import { PageHeader } from "@/components/ui/PageHeader";
import { Readout } from "@/components/ui/Readout";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { DeviceTrendChart } from "@/components/chart/DeviceTrendChart";
import type { ChartThreshold } from "@/components/chart/TrendChart";
import { RuleList } from "@/components/rules/RuleList";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { CommandHistory } from "@/components/actuators/CommandHistory";
import { leafPredicates } from "@/components/rules/RuleSummary";
import { buildSketch } from "@/lib/firmware-sketch";
import { ApiRequestError } from "@/lib/api-client";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CommandResponse = components["schemas"]["CommandResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type NotificationResponse = components["schemas"]["NotificationResponse"];

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCommandValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  return String(value);
}

/** Live value shown with its catalog decimals honoured; the raw number
 * (with `toLocaleString`) when the metric declares none. */
function formatReading(value: number, meta?: CatalogMetric): string | number {
  if (meta?.decimals != null && Number.isFinite(value)) return value.toFixed(meta.decimals);
  return value;
}

function CurrentReadings({
  deviceId,
  thresholdsByMetric,
  metricMeta,
}: {
  deviceId: string;
  thresholdsByMetric: Record<string, ChartThreshold[]>;
  /** Catalog metric definitions keyed by wire id, for unit + decimals. */
  metricMeta?: Map<string, CatalogMetric>;
}) {
  const { data, error, isLoading } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`);

  if (isLoading) return <LoadingSkeleton rows={2} rowClassName="h-20" />;
  if (error) return <ErrorState message="Couldn't load current readings." />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No readings yet"
        description="Once this device publishes telemetry, its latest values appear here."
      />
    );
  }

  const [primary, ...rest] = data;
  const primaryMeta = metricMeta?.get(primary.metric);
  const threshold = thresholdsByMetric[primary.metric]?.[0]?.value;
  // No historical extent is fetched here — when a rule pins a threshold, show a
  // window around it so "how close to the limit" reads at a glance.
  const span = threshold != null ? Math.max(Math.abs(threshold) * 0.4, 1) : 0;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <Readout
          size="lg"
          label={primary.metric}
          value={formatReading(primary.value, primaryMeta)}
          unit={primaryMeta?.unit ?? undefined}
          stamp={`updated ${timeAgo(primary.time)}`}
          threshold={threshold}
          min={threshold != null ? threshold - span : undefined}
          max={threshold != null ? threshold + span : undefined}
        />
      </Card>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rest.map((m) => {
            const meta = metricMeta?.get(m.metric);
            return (
              <Metric
                key={m.metric}
                label={m.metric}
                value={formatReading(m.value, meta)}
                hint={meta?.unit ?? undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Read-only actuator states for the Overview tab — the Actuators tab has the
 * interactive controls; this is just "what's the state right now" at a glance,
 * derived the same way ActuatorControl finds its actuator list (rule actions). */
function ActuatorStateSummary({ deviceId }: { deviceId: string }) {
  const { data: rules, isLoading: rulesLoading } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  const { data: commands } = useApiSWR<CommandResponse[]>(`/devices/${deviceId}/commands`, {
    refreshInterval: 20_000,
  });

  const actuators = useMemo(() => {
    const set = new Set<string>();
    for (const rule of rules ?? []) {
      for (const raw of rule.actions) {
        if (
          raw.type === "actuator_command" &&
          typeof raw.actuator === "string" &&
          (raw.device_id == null || raw.device_id === deviceId)
        ) {
          set.add(raw.actuator);
        }
      }
    }
    return Array.from(set);
  }, [rules, deviceId]);

  if (rulesLoading) return <LoadingSkeleton rows={1} rowClassName="h-16" />;
  if (actuators.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {actuators.map((actuator) => {
        const latest = commands?.find((c) => c.actuator === actuator);
        return (
          <Metric
            key={actuator}
            label={actuator}
            value={latest ? formatCommandValue(latest.value) : "—"}
            className="min-w-32"
          />
        );
      })}
    </div>
  );
}

function RailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding="sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

function DeviceStatusRail({ device }: { device: DeviceResponse }) {
  const rows: [string, ReactNode][] = [
    ["Connection", <ConnectionBadge key="c" state={device.connection_state} />],
    ["State", <span key="s" className="capitalize">{device.status}</span>],
    ["Last seen", <span key="l" className="font-mono">{timeAgo(device.last_seen_at)}</span>],
    ["Added", <span key="a" className="font-mono">{new Date(device.created_at).toLocaleDateString()}</span>],
    ["Slug", <span key="g" className="font-mono">{device.slug}</span>],
  ];
  return (
    <RailCard title="Device status">
      <dl className="flex flex-col text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0">
            <dt className="font-mono text-xs text-ink-muted">{k}</dt>
            <dd className="text-right text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </RailCard>
  );
}

function ActiveRulesRail({
  rules,
  onViewRules,
}: {
  rules: RuleResponse[] | undefined;
  onViewRules: () => void;
}) {
  const active = (rules ?? []).filter((r) => r.enabled);
  return (
    <RailCard
      title="Active rules"
      action={
        <button type="button" onClick={onViewRules} className="font-mono text-xs text-accent hover:underline">
          Rules →
        </button>
      }
    >
      {active.length === 0 ? (
        <p className="text-sm text-ink-muted">No rules are armed on this device.</p>
      ) : (
        <ul className="flex flex-col">
          {active.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center gap-2 border-t border-border py-2 text-sm first:border-t-0"
            >
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-online" />
              <Link href={`/rules/${rule.id}`} className="text-ink hover:text-accent">
                {rule.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

function RecentAlertsRail({ deviceId }: { deviceId: string }) {
  const { data } = useApiSWR<NotificationResponse[]>("/notifications", { refreshInterval: 30_000 });
  const forDevice = (data ?? []).filter((n) => n.device_id === deviceId).slice(0, 5);

  return (
    <RailCard
      title="Recent alerts"
      action={
        <Link href="/notifications" className="font-mono text-xs text-accent hover:underline">
          All →
        </Link>
      }
    >
      {forDevice.length === 0 ? (
        <p className="text-sm text-ink-muted">No alerts for this device yet.</p>
      ) : (
        <ul className="flex flex-col">
          {forDevice.map((n) => (
            <li key={n.id} className="flex gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <span
                aria-hidden
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  n.read_at == null ? "bg-status-pending" : "bg-border"
                }`}
              />
              <div className="min-w-0">
                <p className="text-ink">{n.message}</p>
                <p className="font-mono text-xs text-ink-muted">{timeAgo(n.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="font-mono text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
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
        className="shrink-0 font-mono text-xs text-accent"
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
      {metrics.map((m) => {
        const id = wireId(m);
        return <TopicRow key={`metric-${id}`} label={`Telemetry — ${m.name}`} topic={`${subtree}/${id}`} />;
      })}
      {actuators.map((a) => {
        const id = wireId(a);
        return (
          <div key={`actuator-${id}`} className="flex flex-col gap-1">
            <TopicRow label={`Command — ${a.name} (device subscribes)`} topic={`${subtree}/cmd/${id}`} />
            <TopicRow
              label={`Desired state — ${a.name} (device subscribes, retained)`}
              topic={`${subtree}/state/${id}`}
            />
            <TopicRow
              label={`Acknowledgement — ${a.name} (device publishes)`}
              topic={`${subtree}/ack/${id}`}
            />
          </div>
        );
      })}
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
      <pre className="max-h-80 overflow-auto rounded-md border border-border bg-surface-raised p-3 text-xs text-ink">
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
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
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
  // Same key CurrentReadings/DeviceTrendChart fetch — deduped. Lets the Overview
  // tab show one "no readings" state instead of the readout and chart each
  // rendering their own.
  const { data: latest, isLoading: latestLoading } = useApiSWR<TelemetryLatestResponse[]>(
    `/devices/${deviceId}/latest`,
  );
  const hasReadings = (latest?.length ?? 0) > 0;
  // Same key DeviceTopics fetches — deduped. Gives readings their unit + decimals.
  const { data: catalogEntry } = useApiSWR<CatalogEntryResponse>(
    device ? `/catalog/${device.catalog_entry_id}` : null,
  );
  const metricMetaByWireId = useMemo(
    () => new Map((catalogEntry?.metrics ?? []).map((m) => [wireId(m), m] as const)),
    [catalogEntry],
  );

  const thresholdsByMetric = useMemo(() => {
    const map: Record<string, ChartThreshold[]> = {};
    for (const rule of rules ?? []) {
      if (!rule.enabled) continue;
      for (const leaf of leafPredicates(rule.condition)) {
        // A multi-device rule may read another device's metric — only this
        // device's leaves belong on this device's chart.
        if (leaf.device_id != null && leaf.device_id !== deviceId) continue;
        (map[leaf.metric] ??= []).push({
          value: leaf.threshold,
          label: `${leaf.operator} ${leaf.threshold}`,
        });
      }
    }
    return map;
  }, [rules, deviceId]);

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
        breadcrumbs={[{ href: "/devices", label: "Devices" }, { label: device.name }]}
        actions={<ConnectionBadge state={device.connection_state} />}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel id="overview" active={tab}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-6">
            {!latestLoading && !hasReadings ? (
              <EmptyState
                title="No readings yet"
                description="Once this device publishes telemetry, its latest values and trend chart appear here."
              />
            ) : (
              <>
                <CurrentReadings
                  deviceId={deviceId}
                  thresholdsByMetric={thresholdsByMetric}
                  metricMeta={metricMetaByWireId}
                />
                <DeviceTrendChart deviceId={deviceId} thresholdsByMetric={thresholdsByMetric} />
              </>
            )}
            <ActuatorStateSummary deviceId={deviceId} />
          </div>
          <div className="flex flex-col gap-4">
            <DeviceStatusRail device={device} />
            <ActiveRulesRail rules={rules} onViewRules={() => setTab("rules")} />
            <RecentAlertsRail deviceId={deviceId} />
          </div>
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

          <FieldRow label="Name">
            {renaming ? (
              <div className="flex flex-wrap gap-2">
                <Input compact value={name} onChange={(e) => setName(e.target.value)} />
                <Button disabled={busy} onClick={() => void saveName()}>
                  Save
                </Button>
                <Button type="button" variant="secondary" onClick={() => setRenaming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
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
          </FieldRow>

          <FieldRow label="Status">
            <div className="flex items-center gap-3">
              <span className="text-sm capitalize text-ink">{device.status}</span>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void toggleStatus()}>
                {device.status === "active" ? "Disable" : "Enable"}
              </Button>
            </div>
          </FieldRow>

          <FieldRow label="Credential">
            {rotated ? (
              <div className="rounded-xl border border-status-pending/40 bg-status-pending-surface p-3 text-sm">
                <p className="font-medium text-ink">Copy this now — it will not be shown again.</p>
                <p className="mt-1 font-mono text-ink">{rotated.username}</p>
                <p className="font-mono text-ink">{rotated.password}</p>
              </div>
            ) : (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void rotateCredential()}>
                Rotate credential
              </Button>
            )}
          </FieldRow>

          <FieldRow label="MQTT topics">
            <DeviceTopics device={device} />
          </FieldRow>

          <FieldRow label="Onboarding code">
            <OnboardingCode device={device} />
          </FieldRow>
        </Card>
      </TabPanel>
    </div>
  );
}
