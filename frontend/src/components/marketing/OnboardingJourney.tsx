"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { Check } from "lucide-react";
import { Badge, Tag } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { cn } from "@/lib/cn";

/**
 * The Onboarding figure (DESIGN.md §10): the four onboarding steps as one
 * example device's journey — a workspace, a device template, the generated
 * sketch with everything filled in, and the device coming online with its
 * first reading. Same fixtures as the control-loop log (northfield,
 * bay1-climate, fan1), so the page tells one story. An illustration, inert.
 */
export const JOURNEY_STAGES = 4;

const STEP_MS = 1500;
const HOLD_MS = 4500;

/** Which stage the figure shows: 0–3 while a stage is in progress, 4 once the
 * device is online. Plays when `ref` scrolls into view, replays after a hold,
 * and stops off screen. Reduced motion shows the finished journey. */
export function useJourney(ref: RefObject<HTMLElement | null>): number {
  const [stage, setStage] = useState(JOURNEY_STAGES);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    let timers: number[] = [];
    const clear = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
    };
    const play = () => {
      clear();
      setStage(0);
      for (let i = 1; i <= JOURNEY_STAGES; i++) timers.push(window.setTimeout(() => setStage(i), i * STEP_MS));
      timers.push(window.setTimeout(play, JOURNEY_STAGES * STEP_MS + HOLD_MS));
    };
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? play() : clear()), { threshold: 0.35 });
    io.observe(el);
    return () => {
      io.disconnect();
      clear();
    };
  }, [ref]);

  return stage;
}

type StageState = "done" | "active" | "todo";

function Stage({ n, time, title, state, children }: { n: number; time: string; title: string; state: StageState; children: ReactNode }) {
  return (
    <li
      className={cn(
        "flex gap-3 rounded-xl border p-3.5 transition-[border-color,background-color,opacity] duration-300",
        state === "active" ? "border-accent bg-accent-muted/40" : "border-border bg-surface",
        state === "todo" && "opacity-45",
      )}
    >
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] text-xs font-semibold",
          state === "done"
            ? "border-status-online bg-status-online text-on-accent"
            : state === "active"
              ? "border-accent bg-surface text-accent"
              : "border-border bg-surface text-ink-muted",
        )}
      >
        {state === "done" ? <Check size={13} /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-sm text-ink">{title}</b>
          <span className="font-mono text-[11.5px] text-ink-muted tabular-nums">{time}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

const SKETCH: [string, string][] = [
  ["MQTT_HOST", '"mqtt.iodriven.tech"'],
  ["TOPIC", '"northfield/bay1-climate/…"'],
  ["MQTT_PASSWORD", '"••••••••"'],
  ["WI-FI", "from a phone · QR"],
];

export function OnboardingJourney({ stage }: { stage: number }) {
  const state = (i: number): StageState => (i < stage ? "done" : i === stage ? "active" : "todo");
  const online = stage >= JOURNEY_STAGES;

  return (
    <div
      role="img"
      aria-label="Onboarding example: a workspace, a device template, the generated sketch, and the device online with its first reading"
      className="rounded-2xl border border-border bg-canvas p-3 shadow-card"
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-3 pt-0.5 text-[12.5px]">
        <span className="font-semibold text-ink">Onboarding · northfield</span>
        <span className="font-mono text-[11.5px] text-ink-muted">example</span>
      </div>
      <ol className="flex flex-col gap-2">
        <Stage n={1} time="0:00" title="Workspace" state={state(0)}>
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-muted">
            <span className="font-mono text-ink">northfield</span> · 2 members
            <Tag size="sm">Admin</Tag>
            <Tag size="sm">Viewer</Tag>
          </span>
        </Stage>
        <Stage n={2} time="2:00" title="Device template · Bay climate" state={state(1)}>
          <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-ink-muted">Publishes</span>
            <Tag mono size="sm">
              temperature · °C
            </Tag>
            <Tag mono size="sm">
              humidity · %
            </Tag>
            <span className="text-ink-muted">Controls</span>
            <Tag mono size="sm">
              fan1
            </Tag>
          </span>
        </Stage>
        <Stage n={3} time="5:00" title="Generated sketch" state={state(2)}>
          <ul className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-[11.5px]">
            {SKETCH.map(([k, v]) => (
              <li key={k} className="contents">
                <span className="text-ink-muted">{k}</span>
                <span className="truncate text-ink">{v}</span>
                <Check aria-hidden size={13} className={cn("self-center", stage > 2 ? "text-status-online" : "text-border")} />
              </li>
            ))}
          </ul>
        </Stage>
        <Stage n={4} time={online ? "9:40" : "—"} title="Flash and power on" state={state(3)}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[13px] text-ink">bay1-climate</span>
            {online ? (
              <Badge tone="online" label="Online" />
            ) : (
              <Badge tone="pending" shape="hollow" label="Waiting for the first message" />
            )}
          </span>
          {/* Before the first message: the readout's empty state, as on the device page. */}
          <Readout
            label="Temperature"
            value={online ? 24.6 : "—"}
            unit={online ? "°C" : undefined}
            min={10}
            max={40}
            threshold={30}
            stamp={online ? "live" : "No data yet"}
            framed={false}
          />
        </Stage>
      </ol>
    </div>
  );
}
