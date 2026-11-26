"use client";

import { Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow } from "@/components/devices/connect/useConnectFlow";
import { cn } from "@/lib/cn";
import { tActive as tr } from "@iodriven/shared/i18n";

/** Step 5: each line turns green as the board connects, reports and answers. */
export function LiveCheckStep({ flow }: { flow: ConnectFlow }) {
  const { device, deviceId, items, live, allLive, boolActuators, phone } = flow;
  return (
    <>
      <h2 className="text-section font-semibold text-ink">{tr("connect3.liveTitle")}</h2>
      <p className="text-sm text-ink-muted">
        {tr("connect3.liveLead", { device: device.name })}
      </p>
      {allLive && (
        <p className="flex items-center gap-2.5 rounded-lg bg-status-online/10 px-4 py-3 text-sm text-ink">
          <Check aria-hidden size={18} className="text-status-online" />
          <span>
            <strong>{tr("connect3.isLive", { device: device.name })}</strong> {tr(boolActuators.length ? "connect3.flowingActuators" : "connect3.flowing")}
          </span>
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border-soft">
        {items.map((it) => {
          const s = live[it.k] ?? {};
          const state = s.ok ? "ok" : s.busy ? "busy" : "wait";
          return (
            <li key={it.k} className="flex items-start gap-3 py-3">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                  state === "ok" ? "bg-status-online text-on-accent" : "bg-surface-raised text-ink-muted",
                )}
              >
                {state === "ok" ? <Check size={13} /> : state === "busy" ? <Loader2 size={13} className="animate-spin" /> : <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="text-sm font-medium text-ink">
                  {it.label}
                  <span className="sr-only">{state === "ok" ? tr("connect3.srDone") : tr("connect3.srWaiting")}</span>
                </strong>
                <span className="font-mono text-xs text-ink-muted">{it.sub}</span>
                {s.detail && <span className="text-xs text-status-online">{s.detail}</span>}
                {state === "wait" && !it.actuator && (
                  <details className="text-xs text-ink-muted">
                    <summary className="cursor-pointer">{tr("connect3.notShowing")}</summary>
                    <p className="mt-1">{it.hint}</p>
                  </details>
                )}
              </div>
              {!it.actuator && (
                <span aria-hidden className={cn("pt-0.5 text-xs", state === "ok" ? "text-status-online" : "text-ink-muted")}>
                  {state === "ok" ? tr("connect3.ok") : tr("connect3.waiting")}
                </span>
              )}
              {it.actuator && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!live.status?.ok || s.ok || s.busy}
                  onClick={() => {
                    if (it.actuator) void flow.sendTest(it.actuator);
                  }}
                >
                  {s.ok ? tr("connect3.acknowledged") : tr("connect3.sendTest")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <StepNav state={allLive ? tr("connect3.liveState", { device: device.name }) : tr("connect3.waitingDevice")} onBack={() => flow.setStep(phone ? 4 : 3)}>
        {/* From a template, with this one's template picked (DESIGN.md §8). */}
        <Button variant="secondary" onClick={() => void flow.leave(`/devices/new?catalog_entry_id=${flow.template.id}`)}>
          {tr("connect3.another")}
        </Button>
        <Button onClick={() => void flow.leave(`/devices/${deviceId}`)}>
          {tr("connect3.openDevice")} <ChevronRight aria-hidden size={14} />
        </Button>
      </StepNav>
    </>
  );
}
