"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { formatNumber } from "@iodriven/shared/i18n";
import { cn } from "@/lib/cn";
import { useLocale, useT } from "@/lib/i18n";

/* One rule's life, replayed (DESIGN.md §10): the temperature climbs past
 * 30 °C, the rule holds, fires, the fan confirms, and it switches off again
 * below 28 °C. Decorative, so it's one labelled image to assistive tech.
 * Under reduced motion it shows a still frame with the fan on. */
const SERIES = [26.1, 26.8, 27.9, 29.2, 30.4, 31.1, 31.5, 31.3, 30.8, 29.9, 29.0, 28.3, 27.7, 27.1, 26.6, 26.3];
const ON = 30;
const OFF = 28;
const HOLD = 3;
const STILL = 8;
const TICK_MS = 900;

type Entry = { id: string; time: string; kind: "in" | "cmd" | "ok"; text: string };

function clock(i: number): string {
  return `14:02:${String(10 + i).padStart(2, "0")}`;
}

/** The rule's state after reading `upTo`, and what it logged on the way. */
function replay(upTo: number, words: { holding: (v: number) => string; command: string; confirmed: string; cleared: (v: number) => string }) {
  let held = 0;
  let fan = false;
  const log: Entry[] = [];
  for (let i = 0; i <= upTo; i++) {
    const v = SERIES[i];
    if (!fan && v > ON) {
      held++;
      if (held === 1) log.push({ id: `${i}h`, time: clock(i), kind: "in", text: words.holding(v) });
      if (held >= HOLD) {
        fan = true;
        log.push({ id: `${i}c`, time: clock(i), kind: "cmd", text: words.command }, { id: `${i}a`, time: clock(i), kind: "ok", text: words.confirmed });
      }
    } else if (!fan) held = 0;
    if (fan && v < OFF) {
      fan = false;
      held = 0;
      log.push({ id: `${i}o`, time: clock(i), kind: "ok", text: words.cleared(v) });
    }
  }
  return { held, fan, log };
}

/** "When **temperature** is…" → the starred parts in bold. */
function bold(text: string): ReactNode[] {
  return text.split("**").map((part, i) => (i % 2 ? <b key={i} className="font-semibold text-white">{part}</b> : part));
}

const spring = { type: "spring", stiffness: 500, damping: 32 } as const;

export function RuleLoopCard({ withLog = false, className }: { withLog?: boolean; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setI(STILL);
      return;
    }
    const id = window.setInterval(() => setI((n) => (n + 1) % (SERIES.length + 3)), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const num = (v: number) => formatNumber(locale, v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const at = Math.min(i, SERIES.length - 1);
  const value = SERIES[at];
  const { held, fan, log } = replay(at, {
    holding: (v) => t("ruleLoop.holding", { value: num(v) }),
    command: t("ruleLoop.command"),
    confirmed: t("ruleLoop.confirmed", { secs: num(0.4) }),
    cleared: (v) => t("ruleLoop.cleared", { value: num(v) }),
  });
  const points = SERIES.slice(0, at + 1)
    .map((s, k) => `${(k / (SERIES.length - 1)) * 300},${46 - ((s - 25) / 7.5) * 44}`)
    .join(" ");
  const yOn = 46 - ((ON - 25) / 7.5) * 44;

  return (
    <MotionConfig reducedMotion="user">
      <div
        role="img"
        aria-label={t("ruleLoop.label")}
        className={cn(
          "rounded-2xl border border-[rgba(148,163,184,0.22)] bg-[rgba(10,16,32,0.72)] p-4 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-md",
          className,
        )}
      >
        <div className="flex items-center justify-between text-[12.5px] text-night-dim">
          <span>{t("ruleLoop.place")}</span>
          <span className={cn("inline-flex items-center gap-1.5", fan ? "text-night-accent" : "text-night-ok")}>
            <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
            {fan ? t("ruleLoop.fired") : t("ruleLoop.armed")}
          </span>
        </div>
        <p className="mb-3 mt-2.5 rounded-[10px] border border-[rgba(129,140,248,0.25)] bg-[rgba(129,140,248,0.1)] px-3 py-2.5 text-[13.5px] leading-normal text-night-ink">
          {bold(t("ruleLoop.sentence", { hold: HOLD }))}
        </p>
        <div className="grid grid-cols-[1.25fr_1fr] gap-2.5">
          <div className="rounded-xl border border-[rgba(148,163,184,0.14)] bg-[rgba(148,163,184,0.07)] px-3 py-2.5">
            <span className="block text-xs text-night-dim">{t("ruleLoop.temperature")}</span>
            <span className="inline-block overflow-hidden align-bottom">
              <AnimatePresence initial={false}>
                <motion.span
                  key={value}
                  className="inline-block font-mono text-[30px] leading-tight text-white tabular-nums"
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0 } }}
                  transition={{ duration: 0.25 }}
                >
                  {num(value)}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="ml-1 text-sm text-night-dim">°C</span>
            <svg aria-hidden viewBox="0 0 300 46" preserveAspectRatio="none" className="mt-1 block h-10 w-full">
              <line x1="0" x2="300" y1={yOn} y2={yOn} stroke="var(--color-night-breach)" strokeOpacity="0.6" strokeDasharray="3 3" />
              <polyline points={points} fill="none" stroke="var(--color-night-chart)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="rounded-xl border border-[rgba(148,163,184,0.14)] bg-[rgba(148,163,184,0.07)] px-3 py-2.5">
            <span className="block text-xs text-night-dim">{t("ruleLoop.fan")}</span>
            <span className={cn("mt-1.5 inline-flex items-center gap-1.5 text-[12.5px]", fan ? "text-night-ok" : "text-night-unknown")}>
              <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
              {fan ? t("ruleLoop.on") : t("ruleLoop.off")}
            </span>
            <motion.div layout transition={spring} className={cn("mt-2 flex h-6 w-11 rounded-full p-[3px]", fan ? "justify-end bg-night-ok" : "bg-[rgba(148,163,184,0.3)]")}>
              <motion.span layout transition={spring} className="h-[18px] w-[18px] rounded-full bg-white" />
            </motion.div>
            <span className="mt-2.5 block text-xs text-night-dim">{t("ruleLoop.holdTime")}</span>
            <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-[rgba(148,163,184,0.18)]">
              <motion.span
                className="block h-full bg-night-amber"
                initial={false}
                animate={{ width: `${(Math.min(fan ? HOLD : held, HOLD) / HOLD) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        </div>
        {withLog && (
          <ul className="mt-3 min-h-[116px] font-mono text-[12.5px] leading-normal text-night-muted">
            <AnimatePresence initial={false}>
              {log
                .slice(-4)
                .reverse()
                .map((e) => (
                  <motion.li
                    key={e.id}
                    layout
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex gap-2.5 border-t border-[rgba(148,163,184,0.1)] py-1"
                  >
                    <span className="text-night-faint">{e.time}</span>
                    <span className={e.kind === "in" ? "text-night-sky" : e.kind === "cmd" ? "text-night-amber" : "text-night-ok"}>{e.text}</span>
                  </motion.li>
                ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </MotionConfig>
  );
}
