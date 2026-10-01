"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Cpu, KeyRound, Pencil, Plus, Power, Trash2, Zap } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuthContext } from "@/lib/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { CopyField } from "@/components/ui/SecretReveal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Readout } from "@/components/ui/Readout";
import { Tabs, TabPanel, type TabItem } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { DeviceTrendChart } from "@/components/chart/DeviceTrendChart";
import type { ChartThreshold } from "@/components/chart/TrendChart";
import { RuleList } from "@/components/rules/RuleList";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { CommandHistory } from "@/components/actuators/CommandHistory";
import { leafPredicates } from "@/components/rules/RuleSummary";
import { ApiRequestError } from "@/lib/api-client";
import { DEVICE_STATUS, deviceStatusKey } from "@/lib/device-status";
import { getDeviceActuators } from "@/lib/device-actuators";
import { timeAgo } from "@/lib/time-ago";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

const TABS = ["overview", "controls", "rules", "settings"] as const;
type DeviceTab = (typeof TABS)[number];

function formatReading(value: number, meta?: CatalogMetric): string | number {
  if (meta?.data_type === "bool") return value ? "On" : "Off";
  if (meta?.decimals != null && Number.isFinite(value)) return value.toFixed(meta.decimals);
  return value;
}

/** One readout per declared metric (demo G): value, unit, a gauge with the
 * rule threshold marked, and "Last value, X ago" once the device is offline
 * — stale data is shown as stale, never as current. */
function Readouts({
  device,
  metrics,
  latest,
  thresholds,
}: {
  device: DeviceResponse;
  metrics: CatalogMetric[];
  latest: TelemetryLatestResponse[];
  thresholds: Record<string, ChartThreshold[]>;
}) {
  const byMetric = new Map(latest.map((l) => [l.metric, l]));
  // Undeclared metrics a device still publishes (legacy templates) come after.
  const ids = [...metrics.map((m) => wireId(m)), ...latest.map((l) => l.metric).filter((id) => !metrics.some((m) => wireId(m) === id))];
  const stale = device.connection_state !== "online";
  return (
    <section aria-label="Latest readings" className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
      {ids.map((id) => {
        const meta = metrics.find((m) => wireId(m) === id);
        const reading = byMetric.get(id);
        const threshold = thresholds[id]?.[0]?.value;
        const span = threshold != null ? Math.max(Math.abs(threshold) * 0.4, 1) : 0;
        const numeric = meta?.data_type !== "bool";
        const min = numeric ? (meta?.min ?? (threshold != null ? threshold - span : undefined)) : undefined;
        const max = numeric ? (meta?.max ?? (threshold != null ? threshold + span : undefined)) : undefined;
        return (
          <Readout
            key={id}
            label={meta?.name ?? id}
            value={reading ? formatReading(reading.value, meta) : "—"}
            unit={reading && numeric ? (meta?.unit ?? undefined) : undefined}
            threshold={numeric ? threshold : undefined}
            min={min}
            max={max}
            stale={!!reading && stale}
            stamp={!reading ? "No data yet" : stale ? `Last value, ${timeAgo(reading.time)}` : `updated ${timeAgo(reading.time)}`}
          />
        );
      })}
    </section>
  );
}

/** MQTT topics are built from slugs, not display names — a device's slug is
 * fixed at creation, so this answers "what do I actually publish to?". */
function DeviceTopics({ device, template }: { device: DeviceResponse; template?: CatalogEntryResponse }) {
  const { memberships, currentTenantId } = useAuthContext();
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug;
  if (!tenantSlug) return null;
  const subtree = `${tenantSlug}/${device.slug}`;
  const rows: [string, string][] = [
    ...(template?.metrics ?? []).map((m): [string, string] => [`Telemetry · ${m.name}`, `${subtree}/${wireId(m)}`]),
    ...(template?.actuators ?? []).flatMap((a): [string, string][] => [
      [`Command · ${a.name}`, `${subtree}/cmd/${wireId(a)}`],
      [`Desired state · ${a.name} (retained)`, `${subtree}/state/${wireId(a)}`],
      [`Acknowledgement · ${a.name}`, `${subtree}/ack/${wireId(a)}`],
    ]),
    ["Health (retained, last will)", `${subtree}/status`],
  ];
  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([label, topic]) => (
        <div key={topic} className="flex flex-col gap-1">
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd>
            <CopyField value={topic} label="topic" />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SettingRow({ title, body, action }: { title: string; body: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 max-w-[52ch]">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-[13px] text-ink-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

export default function DeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { can } = usePermissions();
  const canWrite = can("devices.write");

  const tabParam = params.get("tab");
  const tab: DeviceTab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as DeviceTab) : "overview";
  function setTab(next: string) {
    const q = new URLSearchParams(params.toString());
    if (next === "overview") q.delete("tab");
    else q.set("tab", next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const { data: device, error, isLoading, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  const { data: rules } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  const { data: latest, isLoading: latestLoading } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`);
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  const actuators = useMemo(() => getDeviceActuators(template, rules, deviceId), [template, rules, deviceId]);

  const thresholdsByMetric = useMemo(() => {
    const map: Record<string, ChartThreshold[]> = {};
    for (const rule of rules ?? []) {
      if (!rule.enabled) continue;
      for (const leaf of leafPredicates(rule.condition)) {
        // A multi-device rule may read another device's metric — only this
        // device's leaves belong on this device's chart.
        if (leaf.device_id != null && leaf.device_id !== deviceId) continue;
        const rhs = leaf.rhs;
        if (rhs?.source === "static") {
          (map[leaf.metric] ??= []).push({ value: rhs.value, label: `${leaf.operator} ${rhs.value}` });
        } else if (rhs?.source === "range") {
          (map[leaf.metric] ??= []).push(
            { value: rhs.low, label: `${leaf.operator} ${rhs.low}` },
            { value: rhs.high, label: `${leaf.operator} ${rhs.high}` },
          );
        }
      }
    }
    return map;
  }, [rules, deviceId]);

  // An old ?tab=metrics / ?tab=actuators link lands on its new home.
  useEffect(() => {
    if (tabParam === "metrics") setTab("overview");
    if (tabParam === "actuators") setTab("controls");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  if (isLoading) return <LoadingSkeleton rows={5} rowClassName="h-14" />;
  if (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return (
        <EmptyState
          title="This device doesn't exist"
          description="It may have been deleted, or the link belongs to another workspace."
          action={
            <Link href="/devices" className={buttonClassName({ variant: "secondary" })}>
              Back to devices
            </Link>
          }
        />
      );
    }
    return <ErrorState message={error instanceof ApiRequestError ? error.message : "Couldn't load this device."} onRetry={() => void mutate()} />;
  }
  if (!device) return null;

  const st = DEVICE_STATUS[deviceStatusKey(device)];
  const zone = zones?.find((z) => z.id === device.zone_id);
  const neverConnected = device.connection_state === "never_connected";
  const metrics = template?.metrics ?? [];
  const hasReadings = (latest?.length ?? 0) > 0;

  async function toggleStatus() {
    const next = device!.status === "active" ? "disabled" : "active";
    try {
      await api.patch(`/devices/${deviceId}`, { status: next });
      await mutate();
      void revalidate("/devices");
      toast({ title: next === "active" ? `${device!.name} enabled` : `${device!.name} disabled` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the device", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function remove() {
    const ok = await confirm("Its credential stops working and its telemetry history is removed.", {
      title: `Delete ${device!.name}?`,
      confirmLabel: "Delete device",
    });
    if (!ok) return;
    try {
      await api.delete(`/devices/${deviceId}`);
      void revalidate("/devices");
      toast({ title: `${device!.name} deleted` });
      router.push("/devices");
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the device", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const tabs: TabItem[] = [
    { id: "overview", label: "Overview" },
    { id: "controls", label: "Controls", count: actuators.length },
    { id: "rules", label: "Rules", count: rules?.length },
    { id: "settings", label: "Settings" },
  ];

  const meta = [
    zone && (
      <span key="z">
        Zone{" "}
        <Link href={`/zones?edit=${zone.id}`} className="text-accent hover:underline">
          {zone.name}
        </Link>
      </span>
    ),
    template && (
      <span key="t">
        Template{" "}
        <Link href={`/templates?edit=${template.id}`} className="text-accent hover:underline">
          {template.name}
        </Link>
      </span>
    ),
    <span key="s">
      Last seen <b className="font-medium text-ink">{device.last_seen_at ? timeAgo(device.last_seen_at) : "never"}</b>
    </span>,
    device.fw_version && (
      <span key="f">
        Firmware <b className="font-medium text-ink">{device.fw_version}</b>
      </span>
    ),
    device.rssi != null && (
      <span key="r">
        Signal <b className="font-medium text-ink">{device.rssi} dBm</b>
      </span>
    ),
    device.battery_pct != null && (
      <span key="b">
        Battery <b className="font-medium text-ink">{device.battery_pct}%</b>
      </span>
    ),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }, { label: device.name }]}
        title={device.name}
        monoTitle
        status={<Badge tone={st.tone} shape={st.shape} label={st.label} />}
        meta={<div className="flex flex-wrap gap-x-4 gap-y-1">{meta}</div>}
        actions={
          canWrite ? (
            <>
              {neverConnected && (
                <Link href={`/devices/${deviceId}/connect`} className={buttonClassName()}>
                  <Zap aria-hidden size={15} />
                  Connect device
                </Link>
              )}
              <Link href={`/devices?edit=${deviceId}`} className={buttonClassName({ variant: "secondary" })}>
                <Pencil aria-hidden size={15} />
                Edit device
              </Link>
            </>
          ) : undefined
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Device sections" />

      <TabPanel id="overview" active={tab}>
        {!latestLoading && !hasReadings && metrics.length === 0 ? (
          <EmptyState title="No readings yet" description="Once this device publishes telemetry, its latest values and trend chart appear here." />
        ) : (
          <div className="flex flex-col gap-4">
            {latest && <Readouts device={device} metrics={metrics} latest={latest} thresholds={thresholdsByMetric} />}
            <Card>
              {!hasReadings && neverConnected ? (
                <EmptyState
                  title="Waiting for the first message"
                  description="Flash the sketch and power the board. The chart starts the moment a reading arrives."
                  action={
                    canWrite ? (
                      <Link href={`/devices/${deviceId}/connect`} className={buttonClassName()}>
                        <Zap aria-hidden size={15} />
                        Connect device
                      </Link>
                    ) : undefined
                  }
                />
              ) : (
                <DeviceTrendChart deviceId={deviceId} thresholdsByMetric={thresholdsByMetric} />
              )}
            </Card>
          </div>
        )}
      </TabPanel>

      <TabPanel id="controls" active={tab}>
        <div className="flex flex-col gap-4">
          <ActuatorControl deviceId={deviceId} deviceOnline={device.connection_state === "online"} catalogEntryId={device.catalog_entry_id} />
          {device.connection_state !== "online" && actuators.length > 0 && (
            <p className="text-[13px] text-ink-muted">
              This device is offline. A command sent now becomes its desired state and is delivered when it reconnects, if still inside its TTL.
            </p>
          )}
          <CommandHistory deviceId={deviceId} />
        </div>
      </TabPanel>

      <TabPanel id="rules" active={tab}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">Stale or missing data is unknown. It never fires or clears a rule.</p>
            {can("rules.write") && (
              <Link href={`/rules/new?device=${deviceId}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                <Plus aria-hidden size={14} />
                New rule
              </Link>
            )}
          </div>
          <RuleList deviceId={deviceId} />
        </div>
      </TabPanel>

      <TabPanel id="settings" active={tab}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-ink">Credentials and firmware</h2>
            <SettingRow
              title="Device credential"
              body={
                <>
                  MQTT username <code className="font-mono">{device.id}</code>. Stored as an argon2id hash, so a new one is shown once.
                </>
              }
              action={
                canWrite ? (
                  <Link href={`/devices/${deviceId}/connect`} className={buttonClassName({ variant: "secondary" })}>
                    <KeyRound aria-hidden size={14} />
                    Rotate credential
                  </Link>
                ) : null
              }
            />
            <SettingRow
              title="Firmware"
              body="A ready-to-flash sketch for this device, built from its template. Getting it rotates the credential."
              action={
                canWrite ? (
                  <Link href={`/devices/${deviceId}/connect`} className={buttonClassName({ variant: "secondary" })}>
                    <Cpu aria-hidden size={14} />
                    Get firmware
                  </Link>
                ) : null
              }
            />
          </Card>
          {canWrite && (
            <Card>
              <h2 className="mb-3 text-base font-semibold text-ink">Manage device</h2>
              <SettingRow
                title={device.status === "active" ? "Disable device" : "Enable device"}
                body={device.status === "active" ? "Rules stop evaluating it. Telemetry is still stored." : "Rules evaluate it again from the next reading."}
                action={
                  <Button variant="secondary" onClick={() => void toggleStatus()}>
                    <Power aria-hidden size={14} />
                    {device.status === "active" ? "Disable" : "Enable"}
                  </Button>
                }
              />
              <SettingRow
                title="Delete device"
                body="Revokes its credential and removes its telemetry history."
                action={
                  <Button variant="danger" onClick={() => void remove()}>
                    <Trash2 aria-hidden size={14} />
                    Delete…
                  </Button>
                }
              />
            </Card>
          )}
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-base font-semibold text-ink">MQTT topics</h2>
            <DeviceTopics device={device} template={template} />
          </Card>
        </div>
      </TabPanel>
      {dialog}
    </div>
  );
}
