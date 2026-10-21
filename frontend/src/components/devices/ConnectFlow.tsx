"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { CredentialStep } from "@/components/devices/connect/CredentialStep";
import { FirmwareStep } from "@/components/devices/connect/FirmwareStep";
import { LiveCheckStep } from "@/components/devices/connect/LiveCheckStep";
import { OptionsStep } from "@/components/devices/connect/OptionsStep";
import { PhoneStep } from "@/components/devices/connect/PhoneStep";
import { useConnectFlow, type ConnectFlow as Flow } from "@/components/devices/connect/useConnectFlow";
import { ApiRequestError } from "@/lib/api-client";
import { forgetCredential } from "@/lib/credential-handoff";
import { cn } from "@/lib/cn";
import { DEVICE_STATUS, deviceStatusKey } from "@/lib/device-status";

/** Connect a device (DESIGN.md §8, demo G): credential → options → flash →
 * Wi-Fi from a phone (Espressif provisioning, docs/ble-provisioning.md) →
 * live check. The live check listens on the app's realtime socket.
 *
 * A device whose wiring is set (its own, else its template's) installs the
 * generic firmware from the browser instead: step 3 is Install, with the
 * downloadable sketch kept under Advanced. Others get the sketch, as before.
 * State lives in useConnectFlow; each step is its own component in connect/. */
export function ConnectFlow({ deviceId }: { deviceId: string }) {
  const state = useConnectFlow(deviceId);
  if (state.kind === "error") return <ErrorState title="Couldn't load this device" message={state.error instanceof ApiRequestError ? state.error.message : "The API didn't respond."} />;
  if (state.kind === "loading") return <LoadingSkeleton rows={4} rowClassName="h-16" />;
  const flow = state.flow;
  const { device, template, install, step, phone, credential, allLive } = flow;
  const st = DEVICE_STATUS[deviceStatusKey(device)];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }, { href: `/devices/${deviceId}`, label: device.name }, { label: "Connect" }]}
        title={
          <>
            Connect <span className="font-mono font-medium tracking-[-0.01em]">{device.name}</span>
          </>
        }
        status={<Badge tone={st.tone} shape={st.shape} label={st.label} />}
        description={`${template.name}. About ${install ? "five" : "ten"} minutes from here to live data.`}
        actions={
          <Button variant="ghost" onClick={() => void flow.leave(`/devices/${deviceId}`)}>
            I&apos;ll do this later
          </Button>
        }
      />

      <ForgetWhenLive deviceId={deviceId} live={allLive} />
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <StepList flow={flow} />
        <CompactSteps flow={flow} />
        <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-card">
          {step === 1 && <CredentialStep flow={flow} />}
          {step === 2 && <OptionsStep flow={flow} />}
          {step === 3 && <FirmwareStep flow={flow} />}
          {step === 4 && phone && credential && <PhoneStep flow={flow} credential={credential} />}
          {step === 5 && <LiveCheckStep flow={flow} />}
        </section>
      </div>
      {flow.confirmDialog}
      {flow.guardDialog}
      <p className="sr-only" aria-live="polite">
        {allLive ? `${device.name} is live.` : ""}
      </p>
      {step === 5 && !allLive && (
        <p className="text-xs text-ink-muted">
          Stuck? The device page shows its <Link href={`/devices/${deviceId}`} className="text-accent hover:underline">status and readings</Link> too.
        </p>
      )}
    </>
  );
}

/** Once the device is live, its credential has done its job here: forget it
 * (lib/credential-handoff keeps it for the flow's length only). */
function ForgetWhenLive({ deviceId, live }: { deviceId: string; live: boolean }) {
  useEffect(() => {
    if (live) forgetCredential(deviceId);
  }, [deviceId, live]);
  return null;
}

const stepsFor = ({ install, phone }: Pick<Flow, "install" | "phone">): [string, string][] => [
  ["Credential", "Shown once"],
  ["Options", install ? "Wiring, Wi-Fi, broker" : "Board, Wi-Fi, pins"],
  install ? ["Install", "Over USB, from here"] : ["Flash", "Download and upload"],
  ["Wi-Fi", phone ? "From your phone" : "Skipped: typed in"],
  ["Live check", "First data"],
];

/** Phones (DESIGN.md §8): "Step n of N" over a progress bar, never a list
 * that scrolls sideways. */
function CompactSteps({ flow }: { flow: Flow }) {
  const steps = stepsFor(flow);
  return (
    <div className="md:hidden">
      <p className="mb-1.5 text-[13px] text-ink-muted">
        Step{" "}
        <b className="text-ink">
          {flow.step} of {steps.length}
        </b>{" "}
        · {steps[flow.step - 1]?.[0]}
      </p>
      <div
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={flow.step}
        className="h-1 overflow-hidden rounded-full bg-border"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${(flow.step / steps.length) * 100}%` }} />
      </div>
    </div>
  );
}

function StepList({ flow }: { flow: Flow }) {
  const { phone, step, stored, allLive } = flow;
  const steps = stepsFor(flow);
  return (
    <ol aria-label="Steps" className="flex flex-col gap-1 max-md:hidden">
      {steps.map(([title, sub], i) => {
        const n = i + 1;
        const skipped = n === 4 && !phone;
        const state = (n === 5 && allLive) || (n < step && !skipped) ? "done" : n === step ? "cur" : "todo";
        return (
          <li key={title}>
            <button
              type="button"
              disabled={(n > 1 && !stored) || skipped}
              aria-current={n === step ? "step" : undefined}
              onClick={() => flow.setStep(n)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50",
                n === step ? "bg-accent-muted" : "hover:bg-surface-raised",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  state === "done" ? "bg-status-online text-on-accent" : state === "cur" ? "bg-accent text-on-accent" : "bg-surface-raised text-ink-muted",
                )}
              >
                {state === "done" ? <Check aria-hidden size={13} /> : skipped ? "–" : n}
              </span>
              <span className="flex flex-col">
                <strong className="whitespace-nowrap text-sm font-medium text-ink">{title}</strong>
                <small className="whitespace-nowrap text-xs text-ink-muted">{sub}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
