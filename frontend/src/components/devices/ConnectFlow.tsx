"use client";

import { useEffect } from "react";
import { Stepper } from "@/components/ui/Stepper";
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
  const { device, template, step, phone, credential, allLive } = flow;
  const st = DEVICE_STATUS[deviceStatusKey(device)];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }, { href: `/devices/${deviceId}`, label: device.name }, { label: "Connect" }]}
        eyebrow={`${template.name} · ${template.runs_on === "generic_firmware" ? "Our firmware" : "Custom firmware"}`}
        title={
          <>
            Connect <span className="font-mono font-medium tracking-[-0.01em]">{device.name}</span>
          </>
        }
        status={<Badge tone={st.tone} shape={st.shape} label={st.label} />}
        actions={
          <Button variant="ghost" onClick={() => void flow.leave(`/devices/${deviceId}`)}>
            I&apos;ll do this later
          </Button>
        }
      />

      <ForgetWhenLive deviceId={deviceId} live={allLive} />
      {/* A wizard (DESIGN.md §5, demo H): the steps across the top, each
          step's content on the page, Back / Continue in the bottom bar. */}
      <section className="@container flex min-w-0 max-w-[760px] flex-col gap-4">
        <StepperFor flow={flow} />
        {step === 1 && <CredentialStep flow={flow} />}
        {step === 2 && <OptionsStep flow={flow} />}
        {step === 3 && <FirmwareStep flow={flow} />}
        {step === 4 && phone && credential && <PhoneStep flow={flow} credential={credential} />}
        {step === 5 && <LiveCheckStep flow={flow} />}
      </section>
      {flow.confirmDialog}
      {flow.guardDialog}
      <p className="sr-only" aria-live="polite">
        {allLive ? `${device.name} is live.` : ""}
      </p>
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

/** The wizard's steps (ui/Stepper). Wi-Fi is a step only when it's set up
 * from a phone; typed in, it goes on the board at Install. */
function StepperFor({ flow }: { flow: Flow }) {
  const { install, phone, step, stored, setStep } = flow;
  const steps: { n: number; label: string }[] = [
    { n: 1, label: "Credential" },
    { n: 2, label: "Options" },
    { n: 3, label: install ? "Install" : "Flash" },
    ...(phone ? [{ n: 4, label: "Wi-Fi" }] : []),
    { n: 5, label: "Live check" },
  ];
  // Steps can be picked (skip to Live check when the board is already installed),
  // but only once the one-time password is stored.
  return (
    <Stepper
      steps={steps.map((s) => ({ id: String(s.n), label: s.label }))}
      current={Math.max(0, steps.findIndex((s) => s.n === step))}
      onPick={(i) => setStep(steps[i].n)}
      canPick={(i) => steps[i].n === 1 || stored}
    />
  );
}
