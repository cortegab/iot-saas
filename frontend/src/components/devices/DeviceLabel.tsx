"use client";

import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { deviceLink } from "@/lib/device-link";
import { downloadSvg, fileBase, labelSvg, printSvg, qrPath } from "@/lib/qr-svg";
import { tActive as tr } from "@iodriven/shared/i18n";

/** A sticker for the device (docs/ble-provisioning.md, "Device label"): a QR
 * of its link, which the IO Driven app opens on the device and a phone's camera
 * opens on the web. It carries no secret, unlike the provisioning QR. */
export function DeviceLabel({ device }: { device: { id: string; name: string } }) {
  const toast = useToast();
  const svg = () => labelSvg(device.name, tr("dpeek.labelSub"), qrPath(deviceLink(window.location.origin, device.id)));

  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span>{tr("dpeek.labelLead")}</span>
      <Button
        variant="link"
        className="text-meta"
        onClick={() => {
          if (!printSvg(svg(), device.name)) {
            toast({ tone: "error", title: tr("dpeek.printBlocked"), detail: tr("dpeek.printBlockedDetail") });
          }
        }}
      >
        {tr("dpeek.printLabel")}
      </Button>
      <Button variant="link" className="text-meta" onClick={() => downloadSvg(svg(), `${fileBase(device.name)}-label.svg`)}>
        {tr("dpeek.download")}
      </Button>
    </span>
  );
}
