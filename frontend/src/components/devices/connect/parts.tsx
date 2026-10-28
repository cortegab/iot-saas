"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { SAVE_BAR } from "@/components/editor/save-bar";
import type { ConnectFlow } from "@/components/devices/connect/useConnectFlow";

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function OptionGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string, string])[];
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-meta font-medium text-ink">{label}</legend>
      {options.map(([v, title, sub]) => (
        <label
          key={v}
          className={cn(
            "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 rounded-md border border-border bg-canvas px-3 py-2.5 hover:border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-border))]",
            value === v && "border-accent bg-accent-muted",
          )}
        >
          <input type="radio" name={label} value={v} checked={value === v} onChange={() => onChange(v)} className="mt-[3px] accent-[var(--color-accent)]" />
          <span className="flex flex-col">
            <strong className="text-sm font-medium text-ink">{title}</strong>
            <small className="text-xs text-ink-muted">{sub}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The wizard's bottom bar (DESIGN.md §5, demo H): what this step waits for,
 * then Back and Continue (or the step's own buttons in `children`). Sticky,
 * above the phone tab bar. */
export function StepNav({
  onBack,
  onNext,
  nextDisabled,
  state,
  children,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  /** One line on what this step needs ("Store the password, then continue"). */
  state?: string;
  children?: ReactNode;
}) {
  return (
    <div data-savebar className={SAVE_BAR}>
      <span className="mr-auto min-w-[150px] text-meta text-ink-muted">{state}</span>
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft aria-hidden size={14} />
          Back
        </Button>
      )}
      {children}
      {onNext && (
        <Button onClick={onNext} disabled={nextDisabled}>
          Continue <ChevronRight aria-hidden size={14} />
        </Button>
      )}
    </div>
  );
}

/** What the Serial Monitor prints when the board connects. */
export function SerialMonitor({ flow }: { flow: ConnectFlow }) {
  const { phone, name, ssid, credential, device } = flow;
  const lines = [
    ...(phone ? [`[PROV] no Wi-Fi stored, advertising over BLE as ${name}`, "[PROV] Wi-Fi received from the app", "[PROV] Wi-Fi saved"] : [`[WIFI] connecting to ${ssid || "your network"}`]),
    "[WIFI] connected, IP: 192.168.1.42",
    `[MQTT] connecting as ${credential?.username ?? device.id} ... connected`,
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex justify-between border-b border-border bg-surface-raised px-3 py-2 text-xs text-ink-muted">
        <span>What the Serial Monitor shows when it works</span>
        <span className="font-mono">115200</span>
      </div>
      <pre className="overflow-auto bg-canvas p-3 font-mono text-xs leading-[1.55] text-ink">{lines.join("\n")}</pre>
    </div>
  );
}
