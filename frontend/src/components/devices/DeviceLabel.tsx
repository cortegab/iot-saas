"use client";

import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { deviceLink } from "@/lib/device-link";
import { downloadSvg, fileBase, labelSvg, printSvg, qrPath } from "@/lib/qr-svg";

/** A sticker for the device (docs/ble-provisioning.md, "Device label"): a QR
 * of its link, which the IO Driven app opens on the device and a phone's camera
 * opens on the web. It carries no secret, unlike the provisioning QR. */
export function DeviceLabel({ device }: { device: { id: string; name: string } }) {
  const toast = useToast();
  const svg = () => labelSvg(device.name, "Scan to open in IO Driven", qrPath(deviceLink(window.location.origin, device.id)));

  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span>A QR that opens this device. It holds no password.</span>
      <Button
        variant="link"
        className="text-meta"
        onClick={() => {
          if (!printSvg(svg(), device.name)) {
            toast({ tone: "error", title: "The print window was blocked", detail: "Download the label and print it instead." });
          }
        }}
      >
        Print label
      </Button>
      <Button variant="link" className="text-meta" onClick={() => downloadSvg(svg(), `${fileBase(device.name)}-label.svg`)}>
        Download
      </Button>
    </span>
  );
}
