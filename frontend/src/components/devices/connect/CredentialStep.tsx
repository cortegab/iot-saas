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
import { tActive as tr } from "@iodriven/shared/i18n";

/** Step 1: create or rotate the device's MQTT credential, shown once. */
export function CredentialStep({ flow }: { flow: ConnectFlow }) {
  const { can } = usePermissions();
  const { credential, neverConnected, device, rotating } = flow;
  return (
    <>
      {!credential ? (
        <>
          <h2 className="text-section font-semibold text-ink">{tr("connect2.credential")}</h2>
          <Callout tone="warning">
            <strong>{tr(neverConnected ? "connect2.createsWarn" : "connect2.rotatesWarn")}</strong>{" "}
            {flow.install ? tr("connect2.installPuts") : tr("connect2.fingerprint")}{" "}
            {neverConnected
              ? tr("connect2.nothingInterrupted")
              : tr(flow.install ? "connect2.goesOfflineInstall" : "connect2.goesOfflineSketch", { device: device.name })}
          </Callout>
          {can("devices.write") ? (
            <div>
              <Button variant={neverConnected ? "primary" : "secondary-danger"} disabled={rotating} onClick={() => void flow.rotate()}>
                <KeyRound aria-hidden size={15} />
                {rotating ? tr("connect2.working") : neverConnected ? tr("connect2.createCredential") : tr("connect2.rotateCredential")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">{tr("connect2.onlyAdmins")}</p>
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
  // Install writes the password to the board, so there's nothing to store by
  // hand: no "I've stored it" gate on that path.
  const [stored, setStored] = useState(flow.stored || flow.install != null);
  const fields = [
    { label: tr("connect2.username"), value: credential.username, warning: undefined },
    {
      label: tr("connect2.password"),
      value: credential.password,
      warning: flow.install ? tr("connect2.notShownInstall") : tr("connect2.notShownSketch"),
    },
  ];
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-section font-semibold text-ink">{flow.install ? tr("connect2.itsCredential") : tr("connect2.storeCredential")}</h2>
        <p className="text-meta text-ink-muted">
          {tr(flow.install ? "connect2.signsInInstall" : "connect2.signsIn")}
        </p>
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
      {!flow.install && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          {tr("connect2.stored")}
        </label>
      )}
      <StepNav
        state={flow.install ? tr("connect2.continueOptions") : tr("connect2.storeThenContinue")}
        nextDisabled={!stored}
        onNext={() => {
          flow.setStored(true);
          flow.setStep(2);
        }}
      />
    </>
  );
}
