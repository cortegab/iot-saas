"use client";

import { useState } from "react";
import { Box, Check, Cpu, LayoutDashboard, ListChecks } from "lucide-react";
import { Badge, Tag } from "@/components/ui/Badge";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { Readout } from "@/components/ui/Readout";
import { cn } from "@/lib/cn";

/** The landing's product tour (demo G): tabs over illustrative screens built
 * from the app's real components with fixture data. Inert — it's a picture. */
const TOUR = {
  dashboards: {
    label: "Dashboards",
    icon: LayoutDashboard,
    title: "Live readings, trends and controls on one page",
    points: [
      "Value cards, trend charts, gauges, device status and actuator switches.",
      "Readings stream over WebSocket; charts read 1-minute rollups, never raw rows.",
      "Each member builds their own dashboards. Offline devices show their last value, marked stale.",
    ],
  },
  devices: {
    label: "Devices",
    icon: Cpu,
    title: "Every device, its state and its last reading",
    points: [
      "Online, offline, never connected and disabled at a glance, with filters and bulk actions.",
      "Per-device MQTT credentials, stored hashed with argon2id and shown once.",
      "Commands to an offline device become its desired state, delivered on reconnect within the TTL.",
    ],
  },
  rules: {
    label: "Rules",
    icon: ListChecks,
    title: "Rules you can read out loud",
    points: [
      "Conditions across devices with ALL / ANY groups, edited as a form or as a ladder.",
      "Hold time, hysteresis and cooldown on every rule; hardware rules are checked before they save.",
      "Preview unsaved edits, replay the last 24 hours, and latch until someone resets.",
    ],
  },
  templates: {
    label: "Device templates",
    icon: Box,
    title: "Describe a kind of device once",
    points: [
      "Metrics, units, ranges and publish cadence; actuators and their values.",
      "Keys become MQTT topic segments, validated so topics can't break.",
      "Renaming a key used by rules or widgets warns you before it breaks them.",
    ],
  },
} as const;
type TourKey = keyof typeof TOUR;

const strip = (fires: number[]): StripCell[] => Array.from({ length: 48 }, (_, i) => (fires.includes(i) ? "fired" : "idle"));

function Screen({ tab }: { tab: TourKey }) {
  if (tab === "dashboards") {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Readout label="Temperature · bay1" value={27.4} unit="°C" min={10} max={40} threshold={30} stamp="live" />
        <Readout label="Humidity · bay1" value={64} unit="%" min={0} max={100} stamp="live" />
        <Readout label="Tank level · pumphouse" value={41} unit="%" min={0} max={100} threshold={20} stamp="Last value, 3 min ago" stale />
      </div>
    );
  }
  if (tab === "devices") {
    const rows: [string, "online" | "offline" | "unknown", string, string][] = [
      ["bay1-climate", "online", "Climate sensor", "27.4 °C"],
      ["bay2-climate", "online", "Climate sensor", "26.1 °C"],
      ["pumphouse", "offline", "Tank + pump", "41 %"],
      ["door-north", "unknown", "Door contact", "—"],
    ];
    return (
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
        {rows.map(([name, tone, tpl, last]) => (
          <li key={name} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono text-ink">{name}</span>
            <span className="hidden text-ink-muted sm:inline">{tpl}</span>
            <Badge tone={tone} label={tone === "online" ? "Online" : tone === "offline" ? "Offline" : "Never connected"} shape={tone === "unknown" ? "hollow" : "solid"} />
            <span className="w-16 text-right tabular-nums text-ink">{last}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (tab === "rules") {
    const rules: [string, string, number[]][] = [
      ["Too hot → fan on", "When temperature on bay1 is above 30 °C for 10 s, turn fan1 on; when that's no longer true, turn fan1 back off.", [19, 21, 33]],
      ["Tank low → stop pump", "When tank level on pumphouse is below 20 % for 10 s, turn pump1 off and latch until reset.", [40]],
    ];
    return (
      <div className="flex flex-col gap-3">
        {rules.map(([name, sentence, fires]) => (
          <div key={name} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm text-ink">{name}</strong>
              <Badge tone="online" label="Armed" />
            </div>
            <p className="text-[13px] text-ink">{sentence}</p>
            <MiniStrip cells={strip(fires)} label={`Fired ${fires.length} times in 24 h`} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        ["Climate sensor", ["temperature · °C", "humidity · %"], ["fan1"]],
        ["Tank + pump", ["tank_level · %", "flow_rate · l/min"], ["pump1"]],
      ].map(([name, metrics, acts]) => (
        <div key={name as string} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5 text-[13px]">
          <strong className="text-sm text-ink">{name as string}</strong>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">Publishes</span>
            {(metrics as string[]).map((m) => (
              <Tag key={m} mono size="sm">
                {m}
              </Tag>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">Controls</span>
            {(acts as string[]).map((a) => (
              <Tag key={a} mono size="sm">
                {a}
              </Tag>
            ))}
          </span>
          <code className="font-mono text-[12px] text-ink-muted">northfield/{"{device}"}/cmd/{(acts as string[])[0]}</code>
        </div>
      ))}
    </div>
  );
}

export function ProductTour() {
  const [tab, setTab] = useState<TourKey>("dashboards");
  const t = TOUR[tab];
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Product areas" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {(Object.keys(TOUR) as TourKey[]).map((k) => {
          const Icon = TOUR[k].icon;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm",
                tab === k ? "bg-accent-muted font-medium text-accent-strong" : "text-ink-muted hover:bg-surface-raised hover:text-ink",
              )}
            >
              <Icon aria-hidden size={16} />
              {TOUR[k].label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <h3 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t.title}</h3>
          <ul className="flex flex-col gap-2.5">
            {t.points.map((p) => (
              <li key={p} className="flex gap-2 text-[14.5px] text-ink">
                <Check aria-hidden size={16} className="mt-1 shrink-0 text-accent" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-canvas shadow-pop" aria-label={`${t.label}, illustrated`}>
          <div className="flex items-center gap-1.5 border-b border-border bg-surface px-3 py-2">
            <i className="h-2.5 w-2.5 rounded-full bg-border" />
            <i className="h-2.5 w-2.5 rounded-full bg-border" />
            <i className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="ml-2 font-mono text-[11.5px] text-ink-muted">app.iodriven.tech/{tab === "templates" ? "templates" : tab}</span>
          </div>
          <div className="p-4" inert>
            <Screen tab={tab} />
          </div>
        </div>
      </div>
    </div>
  );
}
