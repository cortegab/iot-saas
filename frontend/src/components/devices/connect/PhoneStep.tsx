"use client";

import { ProvisioningQr } from "@/components/devices/ProvisioningQr";
import { SerialMonitor, StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow } from "@/components/devices/connect/useConnectFlow";
import type { SketchCredential } from "@/lib/firmware-sketch";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

const APP_LINKS = {
  android: "https://play.google.com/store/apps/details?id=com.espressif.provble",
  ios: "https://apps.apple.com/app/esp-ble-provisioning/id1473590141",
};

/** Step 4: Wi-Fi from a phone (Espressif provisioning, docs/ble-provisioning.md). */
export function PhoneStep({ flow, credential }: { flow: ConnectFlow; credential: SketchCredential }) {
  const { install, device, name, security, boardInfo } = flow;
  return (
    <>
      <h2 className="text-section font-semibold text-ink">{tr("connect3.phoneTitle")}</h2>
      <p className="text-sm text-ink-muted">
        {richT(
          tr,
          "connect3.phoneLead",
          { name: <b className="font-mono text-ink">{name}</b> },
          { what: tr(install ? "connect3.whatFirmware" : "connect3.whatSketch"), led: install ? tr("connect3.ledSlow") : "" },
        )}
      </p>
      <ProvisioningQr deviceName={device.name} username={credential.username} password={credential.password} security={security} />
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">{tr("connect3.inApp")}</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>{tr("connect3.app1")}</li>
          <li>{tr("connect3.pickNetwork")}</li>
          <li>{tr("connect3.app3")}</li>
        </ol>
        <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">{tr("connect3.orEsp")}</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>
            {richT(tr, "connect3.esp1", {
              android: (
                <a href={APP_LINKS.android} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Android
                </a>
              ),
              ios: (
                <a href={APP_LINKS.ios} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  iOS
                </a>
              ),
            })}
          </li>
          <li>{tr("connect3.pickNetwork")}</li>
          <li>{tr("connect3.esp3")}</li>
        </ol>
        <p className="mt-2 text-xs text-ink-muted">
          {tr("connect3.later", { button: install ? install.model.reset.label : boardInfo.resetButton })}
        </p>
      </div>
      <SerialMonitor flow={flow} />
      <StepNav state={tr("connect3.phoneState")} onBack={() => flow.setStep(3)} onNext={() => flow.setStep(5)} />
    </>
  );
}
