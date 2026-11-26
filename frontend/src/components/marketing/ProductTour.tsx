"use client";

import { useState } from "react";
import { Box, Check, Cpu, LayoutDashboard, ListChecks } from "lucide-react";
import { Badge, Tag } from "@/components/ui/Badge";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { Readout } from "@/components/ui/Readout";
import { cn } from "@/lib/cn";
import { marketingCopy } from "@/lib/marketing-copy";
import { useLocale } from "@/lib/i18n";

/** The landing's product tour (demo G): tabs over illustrative screens built
 * from the app's real components with fixture data. Inert — it's a picture. */
// Each area's icon; the words are in lib/marketing-copy.ts.
const TOUR = {
  dashboards: LayoutDashboard,
  devices: Cpu,
  rules: ListChecks,
  templates: Box,
} as const;
type TourKey = keyof typeof TOUR;

const strip = (fires: number[]): StripCell[] => Array.from({ length: 48 }, (_, i) => (fires.includes(i) ? "fired" : "idle"));

function Screen({ tab }: { tab: TourKey }) {
  const sc = marketingCopy(useLocale()).tour.screen;
  if (tab === "dashboards") {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Readout label={sc.temperature} value={27.4} unit="°C" min={10} max={40} threshold={30} stamp="live" />
        <Readout label={sc.humidity} value={64} unit="%" min={0} max={100} stamp="live" />
        <Readout label={sc.tank} value={41} unit="%" min={0} max={100} threshold={20} stamp={sc.lastValue} stale />
      </div>
    );
  }
  if (tab === "devices") {
    const rows: [string, "online" | "offline" | "unknown", string, string][] = [
      ["bay1-climate", "online", sc.climate, "27.4 °C"],
      ["bay2-climate", "online", sc.climate, "26.1 °C"],
      ["pumphouse", "offline", sc.tankPump, "41 %"],
      ["door-north", "unknown", sc.door, "—"],
    ];
    return (
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
        {rows.map(([name, tone, tpl, last]) => (
          <li key={name} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono text-ink">{name}</span>
            <span className="hidden text-ink-muted sm:inline">{tpl}</span>
            <Badge tone={tone} label={tone === "online" ? sc.online : tone === "offline" ? sc.offline : sc.never} shape={tone === "unknown" ? "hollow" : "solid"} />
            <span className="w-16 text-right tabular-nums text-ink">{last}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (tab === "rules") {
    const fires = [[19, 21, 33], [40]];
    const rules: [string, string, number[]][] = sc.rules.map(([name, sentence], i) => [name, sentence, fires[i]]);
    return (
      <div className="flex flex-col gap-3">
        {rules.map(([name, sentence, fires]) => (
          <div key={name} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm text-ink">{name}</strong>
              <Badge tone="online" label={sc.armed} />
            </div>
            <p className="text-[13px] text-ink">{sentence}</p>
            <MiniStrip cells={strip(fires)} label={sc.fired.replace("{count}", String(fires.length))} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        [sc.climate, ["temperature · °C", "humidity · %"], ["fan1"]],
        [sc.tankPump, ["tank_level · %", "flow_rate · l/min"], ["pump1"]],
      ].map(([name, metrics, acts]) => (
        <div key={name as string} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5 text-[13px]">
          <strong className="text-sm text-ink">{name as string}</strong>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">{sc.publishes}</span>
            {(metrics as string[]).map((m) => (
              <Tag key={m} mono size="sm">
                {m}
              </Tag>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">{sc.controls}</span>
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
  const copy = marketingCopy(useLocale()).tour;
  const t = copy.tabs[tab];
  return (
    <div className="flex flex-col gap-7">
      <div role="tablist" aria-label={copy.tabsLabel} className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {(Object.keys(TOUR) as TourKey[]).map((k) => {
          const Icon = TOUR[k];
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium",
                tab === k ? "border-ink bg-ink text-canvas" : "border-border bg-surface text-ink-muted hover:text-ink",
              )}
            >
              <Icon aria-hidden size={16} />
              {copy.tabs[k].label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="grid items-start gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-10">
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
        <div className="overflow-hidden rounded-xl border border-border bg-canvas shadow-pop" aria-label={copy.illustrated.replace("{label}", t.label)}>
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
