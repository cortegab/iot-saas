"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Demo G's "Control loop" card (Onboarding): one rule's life as a log — a
 * reading crosses the threshold, the rule holds and fires, the command goes
 * out, the actuator acknowledges, and later the rule clears. Lines arrive one
 * by one when the card scrolls into view, then the loop replays. Reduced
 * motion shows the whole log at once. An illustration with example data.
 */
type Kind = "in" | "rule" | "cmd" | "ack" | "clear";

const LINES: [string, Kind, string, ReactNode][] = [
  ["13:31:02.114", "in", "bay1-climate", <>temperature <b>30.8 °C</b> &gt; 30 °C · hold starts</>],
  ["13:31:12.120", "rule", "Too hot → fan on", <>held 10 s · <b>fires</b></>],
  ["13:31:12.198", "cmd", "northfield/bay1-climate/cmd/fan1", "{ value: true, ttl: 30 }"],
  ["13:31:12.332", "ack", "fan1", <><b>on</b> · breach → ack <b>218 ms</b></>],
  ["13:43:40.902", "clear", "temperature 27.6 °C", "below 28 °C re-arm · fan1 back off"],
];

const KIND_COLOUR: Record<Kind, string> = {
  in: "text-night-sky",
  rule: "text-[#a5b4fc]",
  cmd: "text-night-amber",
  ack: "text-night-ok",
  clear: "text-[#94a3b8]",
};

const STEP_MS = 900;
const HOLD_MS = 4200;

export function ControlLoopLog() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(LINES.length);
  const [run, setRun] = useState(0);

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
      setShown(0);
      setRun((r) => r + 1);
      LINES.forEach((_, i) => timers.push(window.setTimeout(() => setShown(i + 1), 300 + i * STEP_MS)));
      timers.push(window.setTimeout(play, 300 + LINES.length * STEP_MS + HOLD_MS));
    };
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? play() : clear()), { threshold: 0.35 });
    io.observe(el);
    return () => {
      io.disconnect();
      clear();
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-label="Example control loop"
      className="overflow-hidden rounded-2xl border border-[rgba(125,211,252,0.22)] bg-[#0b1020] text-night-ink shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]"
    >
      <div className="flex justify-between gap-2.5 border-b border-night-line px-4 py-3 text-[12.5px]">
        <span className="inline-flex items-center gap-2 font-semibold text-white">
          <i aria-hidden className="h-[7px] w-[7px] rounded-full bg-night-ok shadow-[0_0_8px_var(--color-night-ok)]" />
          Control loop
        </span>
        <span className="truncate font-mono text-[11.5px] text-night-faint">bay1-climate · Too hot → fan on</span>
      </div>
      <ol className="flex min-h-[212px] flex-col gap-2 px-4 pb-4 pt-3 font-mono text-[12px]">
        {LINES.slice(0, shown).map(([time, kind, who, what]) => (
          <li
            key={`${run}-${time}`}
            className="mkt-logline grid grid-cols-[92px_44px_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-1 text-[#c3cedc] max-sm:grid-cols-[44px_minmax(0,1fr)]"
          >
            <span className="text-[#6b7a90] max-sm:hidden">{time}</span>
            <span className={`text-[10.5px] font-bold uppercase tracking-[0.06em] ${KIND_COLOUR[kind]}`}>{kind}</span>
            <span className="truncate text-white">{who}</span>
            <span className="col-start-3 text-[#9fb0c6] max-sm:col-start-2 [&_b]:font-semibold [&_b]:text-white">{what}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
