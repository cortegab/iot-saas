"use client";

import { useId, useMemo, useState } from "react";
import { AlertCircle, Clock } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TimezoneSelect } from "@/components/ui/TimezoneSelect";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { richT } from "@/lib/i18n";
import { activeLocale, tActive as tr } from "@iodriven/shared/i18n";
import {
  DEFAULT_SCHEDULE,
  DOW_ORDER,
  dowName,
  clampRepeat,
  cronFromSchedule,
  cronParts,
  ordinal,
  pad2,
  scheduleFromCron,
  scheduleSummary,
  validateCron,
  type ScheduleMode,
  type ScheduleModel,
} from "@/lib/schedule";

const MODES: { value: ScheduleMode; label: string }[] = [
  { value: "daily", get label() { return tr("spick.daily"); } },
  { value: "days", get label() { return tr("spick.days"); } },
  { value: "every", get label() { return tr("spick.every"); } },
  { value: "monthly", get label() { return tr("spick.monthly"); } },
  { value: "custom", get label() { return tr("spick.custom"); } },
];

export interface SchedulePickerProps {
  cron: string;
  timezone: string;
  onChange: (next: { cron: string; timezone: string }) => void;
  disabled?: boolean;
}

/** DESIGN.md §9.5 schedule picker — never asks for cron by default. Cron stays
 * the stored value: a cron the simple controls can't show opens in Custom. */
export function SchedulePicker({ cron, timezone, onChange, disabled }: SchedulePickerProps) {
  // "Custom" is sticky while chosen, even when the typed cron happens to be
  // simple; `keep` remembers values across mode switches.
  const [custom, setCustom] = useState(() => scheduleFromCron(cron).mode === "custom");
  const [keep, setKeep] = useState<Partial<ScheduleModel>>({});
  const s: ScheduleModel = useMemo(
    () => ({ ...DEFAULT_SCHEDULE, ...keep, ...(custom ? { mode: "custom" as const } : scheduleFromCron(cron)) }),
    [cron, custom, keep],
  );

  function apply(next: Partial<ScheduleModel>) {
    const merged: ScheduleModel = { ...s, ...next };
    setKeep({ time: merged.time, days: merged.days, dom: merged.dom, n: merged.n, unit: merged.unit, at: merged.at });
    if (merged.mode === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    const out = cronFromSchedule(merged);
    if (out) onChange({ cron: out, timezone });
  }

  function setMode(mode: ScheduleMode) {
    if (mode === "custom") {
      setCustom(true);
      return;
    }
    // Leaving Custom keeps the time where the typed cron had a single one.
    let time = s.time;
    if (custom) {
      const P = cronParts(cron);
      if (P && P.minutes.length === 1 && P.hours.length >= 1) time = `${pad2(P.hours[0])}:${pad2(P.minutes[0])}`;
    }
    apply({ mode, time, ...(mode === "days" && s.days.length === 0 ? { days: [1, 2, 3, 4, 5] } : {}) });
  }

  const tzField = (
    <Field label={tr("spick.timezone")}>
      <TimezoneSelect value={timezone} disabled={disabled} onChange={(tz) => onChange({ cron, timezone: tz })} />
    </Field>
  );

  const summary = scheduleSummary(cron, timezone);
  const customError = s.mode === "custom" ? validateCron(cron) : null;

  return (
    <div className="flex flex-col gap-3.5">
      <SegmentedControl
        ariaLabel={tr("spick.repeat")}
        size="md"
        options={MODES.map((m) => ({ value: m.value, label: m.label, disabled }))}
        value={s.mode}
        onChange={setMode}
        className="self-start"
      />

      {s.mode === "days" && (
        <DayToggles days={s.days} disabled={disabled} onChange={(days) => apply({ mode: "days", days })} />
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-start gap-x-4 gap-y-3">
        {(s.mode === "daily" || s.mode === "days") && (
          <TimeSelect value={s.time} disabled={disabled} onChange={(time) => apply({ time })} />
        )}

        {s.mode === "every" && (
          <Field
            label={tr("spick.everyLabel")}
            hint={s.unit === "min" ? tr("spick.minHint") : s.at ? tr("spick.onHourAt", { mm: pad2(s.at) }) : tr("spick.onHour")}
          >
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={s.unit === "min" ? 59 : 23}
                value={s.n}
                disabled={disabled}
                aria-label={tr("spick.interval")}
                className="w-[84px] font-mono"
                onChange={(e) => apply({ n: clampRepeat(Number(e.target.value), s.unit) })}
              />
              <Select
                aria-label={tr("spick.unit")}
                value={s.unit}
                disabled={disabled}
                onChange={(e) => {
                  const unit = e.target.value as "min" | "h";
                  apply({ unit, n: clampRepeat(unit === "h" ? Math.min(s.n, 12) : s.n, unit) });
                }}
              >
                <option value="min">{tr("spick.minutes")}</option>
                <option value="h">{tr("spick.hours")}</option>
              </Select>
            </div>
          </Field>
        )}

        {s.mode === "monthly" && (
          <>
            <Field label={tr("spick.onDay")} hint={tr("spick.onDayHint")}>
              <Select value={s.dom} disabled={disabled} onChange={(e) => apply({ dom: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {activeLocale() === "en" ? ordinal(i + 1) : i + 1}
                  </option>
                ))}
              </Select>
            </Field>
            <TimeSelect value={s.time} disabled={disabled} onChange={(time) => apply({ time })} />
          </>
        )}

        {s.mode === "custom" && (
          <Field
            label={tr("spick.cron")}
            error={customError}
            hint={tr("spick.cronHint")}
          >
            <Input mono value={cron} disabled={disabled} onChange={(e) => onChange({ cron: e.target.value, timezone })} />
          </Field>
        )}

        {tzField}
      </div>

      <div
        aria-live="polite"
        className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2.5 text-meta leading-relaxed"
      >
        {summary.valid ? (
          <>
            <Clock aria-hidden size={14} className="mt-1 shrink-0 text-accent" />
            <span>
              {richT(tr, "spick.runs", {
                human: <b className="font-semibold">{summary.human}</b>,
                zone: <span className="text-ink-muted">({summary.zone})</span>,
              })}
              {summary.runs.map((r) => (
                <span
                  key={r}
                  className="ml-1 mr-1.5 inline-block rounded-full border border-border bg-surface px-2 font-mono text-xs"
                >
                  {r}
                </span>
              ))}
            </span>
          </>
        ) : (
          <>
            <AlertCircle aria-hidden size={14} className="mt-1 shrink-0 text-status-error" />
            <span className="text-status-error">{tr("spick.invalid")}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Hour (00–23) and minute (5-minute steps, keeping an off-step minute)
 * selects — never the native time input, which follows the OS locale. */
function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (t: string) => void; disabled?: boolean }) {
  const labelId = useId();
  const [h, m] = value.split(":").map(Number);
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-[5px]">
      <span id={labelId} className="text-xs font-medium text-ink-muted">
        {tr("spick.at")}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex items-center gap-2">
        <Select
          aria-label={tr("spick.hour")}
          className="w-[84px] font-mono"
          value={h}
          disabled={disabled}
          onChange={(e) => onChange(`${pad2(Number(e.target.value))}:${pad2(m)}`)}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>
              {pad2(i)}
            </option>
          ))}
        </Select>
        <span aria-hidden className="font-semibold text-ink-muted">
          :
        </span>
        <Select
          aria-label={tr("spick.minute")}
          className="w-[84px] font-mono"
          value={m}
          disabled={disabled}
          onChange={(e) => onChange(`${pad2(h)}:${pad2(Number(e.target.value))}`)}
        >
          {minutes.map((i) => (
            <option key={i} value={i}>
              {pad2(i)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function DayToggles({
  days,
  onChange,
  disabled,
}: {
  days: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-[5px]">
      <span id={labelId} className="text-xs font-medium text-ink-muted">
        {tr("spick.on")}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1.5">
        {DOW_ORDER.map((d) => {
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={dowName(d)}
              disabled={disabled}
              onClick={() => {
                const next = on ? days.filter((x) => x !== d) : [...days, d];
                if (next.length) onChange(next);
              }}
              className={cn(
                "h-9 w-10 rounded-md border text-meta transition-colors duration-150 disabled:cursor-not-allowed",
                on
                  ? "border-accent bg-accent-muted font-semibold text-accent-strong"
                  : "border-border bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {dowName(d).slice(0, 2)}
            </button>
          );
        })}
        <span className="ml-1.5 inline-flex gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([1, 2, 3, 4, 5])}
            className={buttonClassName({ variant: "ghost", size: "sm" })}
          >
            {tr("spick.weekdays")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([0, 6])}
            className={buttonClassName({ variant: "ghost", size: "sm" })}
          >
            {tr("spick.weekends")}
          </button>
        </span>
      </div>
      {days.length === 1 && <span className="text-xs text-ink-muted">{tr("spick.oneDay")}</span>}
    </div>
  );
}
