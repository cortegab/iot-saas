"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { CopyButton } from "@/components/ui/SecretReveal";
import { StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow } from "@/components/devices/connect/useConnectFlow";

/** Step 1: create or rotate the device's MQTT credential, shown once. */
export function CredentialStep({ flow }: { flow: ConnectFlow }) {
  const { can } = usePermissions();
  const { credential, neverConnected, device, rotating } = flow;
  return (
    <>
      {!credential ? (
        <>
          <h2 className="text-section font-semibold text-ink">Credential</h2>
          <Callout tone="warning">
            <strong>Getting firmware {neverConnected ? "creates" : "rotates"} this device&apos;s credential.</strong> Credentials are stored
            hashed, so the only way to put one in a sketch is to make a new one.{" "}
            {neverConnected ? "This device has never connected, so nothing is interrupted." : `The firmware running on ${device.name} now disconnects until you flash the new sketch.`}
          </Callout>
          {can("devices.write") ? (
            <div>
              <Button variant={neverConnected ? "primary" : "secondary-danger"} disabled={rotating} onClick={() => void flow.rotate()}>
                <KeyRound aria-hidden size={15} />
                {rotating ? "Working…" : neverConnected ? "Create credential" : "Rotate credential…"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Only admins can rotate credentials.</p>
          )}
        </>
      ) : (
        <StoreCredential flow={flow} credential={credential} />
      )}
    </>
  );
}

/** Once it exists (demo H): username and password as read-only fields, each
 * with Copy, the password's "won't be shown again", and Continue in the
 * bottom bar once "I've stored it" is checked. */
function StoreCredential({ flow, credential }: { flow: ConnectFlow; credential: { username: string; password: string } }) {
  const [stored, setStored] = useState(flow.stored);
  const fields = [
    { label: "Username", value: credential.username, warning: undefined },
    {
      label: "Password",
      value: credential.password,
      warning: flow.install ? "It won't be shown again. Install puts it on the board for you." : "It won't be shown again. The sketch you get next has it.",
    },
  ];
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-section font-semibold text-ink">Store its credential</h2>
        <p className="text-meta text-ink-muted">The device signs in to the broker with these. The password is shown once and stored hashed.</p>
      </div>
      {fields.map((f) => (
        <div key={f.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
          <Field label={f.label} warning={f.warning}>
            <Input readOnly mono value={f.value} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          {/* Level with the input: below the label line (12px text + 5px gap). */}
          <div className="mt-[21px]">
            <CopyButton value={f.value} label={f.label.toLowerCase()} />
          </div>
        </div>
      ))}
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        I&apos;ve stored it
      </label>
      <StepNav
        state="Store the password, then continue"
        nextDisabled={!stored}
        onNext={() => {
          flow.setStored(true);
          flow.setStep(2);
        }}
      />
    </>
  );
}
