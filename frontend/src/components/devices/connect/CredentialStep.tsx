"use client";

import { KeyRound } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SecretReveal } from "@/components/ui/SecretReveal";
import type { ConnectFlow } from "@/components/devices/connect/useConnectFlow";

/** Step 1: create or rotate the device's MQTT credential, shown once. */
export function CredentialStep({ flow }: { flow: ConnectFlow }) {
  const { can } = usePermissions();
  const { credential, neverConnected, device, rotating, host, tls } = flow;
  return (
    <>
      <h2 className="text-lg font-semibold text-ink">Credential</h2>
      {!credential ? (
        <>
          <Callout tone="warning">
            <strong>Getting firmware {neverConnected ? "creates" : "rotates"} this device&apos;s credential.</strong> Credentials are stored
            hashed, so the only way to put one in a sketch is to make a new one.{" "}
            {neverConnected ? "This device has never connected, so nothing is interrupted." : `The firmware running on ${device.name} now disconnects until you flash the new sketch.`}
          </Callout>
          {can("devices.write") ? (
            <div>
              <Button variant={neverConnected ? "primary" : "danger"} disabled={rotating} onClick={() => void flow.rotate()}>
                <KeyRound aria-hidden size={15} />
                {rotating ? "Working…" : neverConnected ? "Create credential" : "Rotate credential and continue"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Only admins can rotate credentials.</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            This is the MQTT login for <code className="font-mono">{device.name}</code>. It goes into the sketch, and its password into the phone
            provisioning QR. It&apos;s shown only once, so store it too. Broker: <code className="font-mono">{host}:{tls ? "8883 (TLS)" : "1883"}</code>.
          </p>
          <SecretReveal
            fields={[
              { label: "Username", value: credential.username },
              { label: "Password", value: credential.password, secret: true },
            ]}
            copyValue={`username: ${credential.username}\npassword: ${credential.password}`}
            copyLabel="Copy credential"
            requireAcknowledge
            dismissLabel="Continue"
            onDismiss={() => {
              flow.setStored(true);
              flow.setStep(2);
            }}
          />
        </>
      )}
    </>
  );
}
