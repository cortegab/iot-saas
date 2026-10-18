"use client";

import { ProvisioningQr } from "@/components/devices/ProvisioningQr";
import { SerialMonitor, StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow } from "@/components/devices/connect/useConnectFlow";
import type { SketchCredential } from "@/lib/firmware-sketch";

const APP_LINKS = {
  android: "https://play.google.com/store/apps/details?id=com.espressif.provble",
  ios: "https://apps.apple.com/app/esp-ble-provisioning/id1473590141",
};

/** Step 4: Wi-Fi from a phone (Espressif provisioning, docs/ble-provisioning.md). */
export function PhoneStep({ flow, credential }: { flow: ConnectFlow; credential: SketchCredential }) {
  const { install, device, name, security, boardInfo } = flow;
  return (
    <>
      <h2 className="text-lg font-semibold text-ink">Wi-Fi from your phone</h2>
      <p className="text-sm text-ink-muted">
        Once the {install ? "firmware" : "sketch"} is running, the board waits for Wi-Fi over Bluetooth as <b className="font-mono text-ink">{name}</b>
        {install ? " (its LED blinks slowly)" : ""}. Give it your network with
        the ESP BLE Provisioning app.
      </p>
      <ProvisioningQr deviceName={device.name} username={credential.username} password={credential.password} security={security} />
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">In the app</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>
            Install ESP BLE Provisioning (
            <a href={APP_LINKS.android} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Android
            </a>
            {" · "}
            <a href={APP_LINKS.ios} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              iOS
            </a>
            ).
          </li>
          <li>Tap Provision New Device, then scan this QR.</li>
          <li>Pick a 2.4 GHz network and enter its password.</li>
          <li>The board joins and connects to the broker; the next step turns green.</li>
        </ol>
        <p className="mt-2 text-xs text-ink-muted">
          To give it a different network later, hold {install ? install.model.reset.label : boardInfo.resetButton} for 5 seconds while the board is running. Searching without the QR? Clear the app&apos;s
          &quot;PROV_&quot; name filter in its settings first.
        </p>
      </div>
      <SerialMonitor flow={flow} />
      <StepNav onBack={() => flow.setStep(3)} onNext={() => flow.setStep(5)} />
    </>
  );
}
