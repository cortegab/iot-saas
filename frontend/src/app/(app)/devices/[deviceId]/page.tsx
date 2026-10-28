"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Wrench, Zap } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useChangeToast } from "@/hooks/useChangeToast";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FactList } from "@/components/ui/FactList";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Readout } from "@/components/ui/Readout";
import { Tabs, TabPanel, type TabItem } from "@/components/ui/Tabs";
import { DeviceTrendChart } from "@/components/chart/DeviceTrendChart";
import type { ChartThreshold } from "@/components/chart/TrendChart";
import { RuleList } from "@/components/rules/RuleList";
import { ActuatorControl } from "@/components/actuators/ActuatorControl";
import { DeviceEditor } from "@/components/devices/DeviceEditor";
import { useDeviceActions } from "@/components/devices/useDeviceActions";
import { CommandHistory } from "@/components/actuators/CommandHistory";
import { leafPredicates } from "@/components/rules/RuleSummary";
import { ApiRequestError } from "@/lib/api-client";
import { DEVICE_STATUS, deviceStatusKey } from "@/lib/device-status";
import { formatReading, isBoolMetric } from "@/lib/format-reading";
import { getDeviceActuators } from "@/lib/device-actuators";
import { readingFreshness } from "@/lib/freshness";
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

/** One readout per declared metric (demo H): value, unit, a Live / Stale /
 * No data badge (lib/freshness), a gauge with the
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
        const numeric = !isBoolMetric(meta);
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
            freshness={readingFreshness(!stale, meta, reading?.time)}
            stale={!!reading && stale}
            stamp={!reading ? "Nothing received yet" : stale ? `Last value, ${timeAgo(reading.time)}` : timeAgo(reading.time)}
          />
        );
      })}
    </section>
  );
}

export default function DeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
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
  // The ⋯ menu, rotate and delete: the same actions and confirmations as the devices list.
  const actions = useDeviceActions({ onChanged: () => mutate(), ruleCount: () => rules?.length ?? 0 });

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

  // DESIGN.md §5: going offline or coming back while the page is open is a
  // toast; the header's status says it from then on.
  useChangeToast(device?.id, device ? deviceStatusKey(device) : undefined, (before, now) =>
    now === "offline" && before === "online"
      ? { tone: "warning", title: `${device!.name} went offline`, detail: "Readings show the last ones received. Commands wait until it reconnects." }
      : now === "online" && before !== "online"
        ? { tone: "success", title: `${device!.name} is online`, detail: before === "never" ? "Its first message arrived." : "It reconnected." }
        : null,
  );

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
  const online = device.connection_state === "online";
  const disabled = device.status !== "active";
  const metrics = template?.metrics ?? [];
  const hasReadings = (latest?.length ?? 0) > 0;
  const actuatorNames = new Map(actuators.map((a) => [a.id, a.label]));

  const tabs: TabItem[] = [
    { id: "overview", label: "Overview" },
    { id: "controls", label: "Controls", count: actuators.length },
    { id: "rules", label: "Rules", count: rules?.length },
    { id: "settings", label: "Settings" },
  ];

  // Fills the window (main's bottom padding traded for its own) so the Settings
  // tab's save bar, once there's a change, lands at the bottom like every bar.
  return (
    <div className="-mb-[110px] flex flex-1 flex-col gap-4 pb-6">
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }]}
        eyebrow={
          <span>
            {template ? (
              <Link href={`/templates?peek=${template.id}`} className="hover:text-accent hover:underline">
                {template.name}
              </Link>
            ) : (
              "Device"
            )}
            {" · "}
            {zone ? (
              <Link href={`/zones?peek=${zone.id}`} className="hover:text-accent hover:underline">
                {zone.name}
              </Link>
            ) : (
              "No zone"
            )}
          </span>
        }
        title={device.name}
        description={
          <span className="flex flex-wrap items-center gap-x-1.5">
            <Badge tone={st.tone} shape={st.shape} variant="dot" label={st.label} />
            <span>· last message {device.last_seen_at ? timeAgo(device.last_seen_at) : "never"}</span>
          </span>
        }
        actions={
          <>
            {canWrite &&
              (neverConnected ? (
                <Link href={`/devices/${deviceId}/connect`} className={buttonClassName()}>
                  <Zap aria-hidden size={15} />
                  Connect
                </Link>
              ) : (
                <Link href={`/devices/${deviceId}/connect`} className={buttonClassName({ variant: "secondary" })}>
                  <Wrench aria-hidden size={15} />
                  Install
                </Link>
              ))}
            <DropdownMenu label="More actions" groups={actions.menu(device, { where: "page", onDeleted: () => router.push("/devices") })} />
          </>
        }
      />

      {actions.reveal}

      <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Device sections" />

      <TabPanel id="overview" active={tab}>
        <div className="flex flex-col gap-5">
          {/* Offline is said once, in the header ("Offline · last message …"),
              and each readout is marked Stale; only waiting, which has a next
              step, is a callout here (DESIGN.md §5). */}
          {neverConnected && !disabled ? (
            <Callout>
              <b className="font-medium">Waiting for its first message.</b>{" "}
              {canWrite ? (
                <>
                  <Link href={`/devices/${deviceId}/connect`} className="text-accent underline-offset-[3px] hover:underline">
                    Connect it
                  </Link>{" "}
                  to see readings here.
                </>
              ) : (
                "Readings show up here once it connects."
              )}
            </Callout>
          ) : null}

          {latest && (metrics.length > 0 || hasReadings) ? (
            <Readouts device={device} metrics={metrics} latest={latest} thresholds={thresholdsByMetric} />
          ) : !latestLoading && template && metrics.length === 0 ? (
            <p className="text-sm text-ink-muted">This template has no metrics.</p>
          ) : null}

          {(metrics.length > 0 || hasReadings) && (
            <Card>
              <h2 className="mb-3 text-[15px] font-semibold text-ink">Trend</h2>
              {!hasReadings && neverConnected ? (
                <p className="py-10 text-center text-sm text-ink-muted">The chart starts the moment a reading arrives.</p>
              ) : (
                <DeviceTrendChart deviceId={deviceId} metrics={metrics} thresholdsByMetric={thresholdsByMetric} />
              )}
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Health</h2>
            <Health device={device} />
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="controls" active={tab}>
        <div className="flex flex-col gap-5">
          {/* Said once, here — not on every row (demo H). */}
          {!online && actuators.length > 0 && (
            <Callout tone="warning">
              {disabled
                ? "The device is disabled. It can't connect, so commands can't be sent until it's enabled."
                : `The device is ${st.label.toLowerCase()}. Commands wait in its desired state and apply when it reconnects, if still within their time limit.`}
            </Callout>
          )}
          <ActuatorControl deviceId={deviceId} deviceOnline={online} deviceDisabled={disabled} catalogEntryId={device.catalog_entry_id} />
          <CommandHistory deviceId={deviceId} labels={actuatorNames} />
        </div>
      </TabPanel>

      <TabPanel id="rules" active={tab}>
        <div className="flex flex-col gap-3">
          {can("rules.write") && (rules?.length ?? 0) > 0 && (
            <div className="flex justify-end">
              <Link href={`/rules/new?device=${deviceId}`} className={buttonClassName()}>
                <Plus aria-hidden size={15} />
                New rule
              </Link>
            </div>
          )}
          <RuleList deviceId={deviceId} />
        </div>
      </TabPanel>

      <TabPanel id="settings" active={tab} className="flex-1">
        {/* The one place a device is edited (DESIGN.md §7): plain stacked
            sections; Delete is in the header's ⋯ menu. */}
        <DeviceEditor
          deviceId={deviceId}
          embedded
          onRotate={() => void actions.rotate(device)}
        />
      </TabPanel>
      {actions.dialog}
    </div>
  );
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d) return `${d} d ${h} h`;
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** The device's own report (demo H Health): signal, power, firmware, uptime
 * and the id it uses in MQTT topics. */
function Health({ device }: { device: DeviceResponse }) {
  return (
    <FactList
      facts={[
        ["Signal", device.rssi != null ? `${device.rssi} dBm` : "—"],
        ["Battery", device.battery_pct != null ? `${device.battery_pct} %` : device.last_status_at ? "Mains" : "—"],
        ["Firmware", device.fw_version ?? "—"],
        ["Uptime", device.uptime_s != null ? uptime(device.uptime_s) : "—"],
        ["MQTT id", <span key="id" className="font-mono">{device.slug}</span>],
      ]}
    />
  );
}
