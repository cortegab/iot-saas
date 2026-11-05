"use client";

import { useMemo } from "react";
import { Copy, Download, Printer } from "lucide-react";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { provisioningPayload, provName } from "@/lib/firmware-sketch";
import { downloadSvg, fileBase, labelSvg, printSvg, qrPath } from "@/lib/qr-svg";

/**
 * The Wi-Fi setup QR the iodriven app and ESP BLE Provisioning scan (docs/ble-provisioning.md). Built
 * from the device's own credential: `name` is the BLE-safe device name (the
 * sketch's PROV_NAME), `pop` the MQTT password, plus `username` (the MQTT
 * username) for Security 2. A new credential means a new QR.
 */
export function ProvisioningQr({
  deviceName,
  username,
  password,
  security,
}: {
  deviceName: string;
  username: string;
  password: string;
  security: 1 | 2;
}) {
  const toast = useToast();
  const name = provName(deviceName);
  const payload = provisioningPayload({ name, username, password, security });
  const qr = useMemo(() => qrPath(payload), [payload]);
  const label = () => labelSvg(name, `Wi-Fi setup · Security ${security}`, qr);

  function downloadLabel() {
    downloadSvg(label(), `${fileBase(name)}-provisioning.svg`);
  }

  function printLabel() {
    if (!printSvg(label(), name)) {
      toast({ tone: "error", title: "The print window was blocked", detail: "Download the label and print it instead." });
    }
  }

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(payload);
      toast({ title: "Payload copied", detail: "It includes the device's password." });
    } catch {
      toast({ tone: "error", title: "Couldn't reach the clipboard" });
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-lg border border-border bg-white p-2">
          <svg
            role="img"
            aria-label={`Provisioning QR for ${name}`}
            width={232}
            height={232}
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            shapeRendering="crispEdges"
          >
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
        </div>
        <strong className="font-mono text-sm text-ink">{name}</strong>
        <Tag tone="neutral" size="sm">
          {security === 2 ? "Security 2 – SRP6a" : "Security 1 – PoP"}
        </Tag>
      </div>
      <div className="flex min-w-[220px] flex-1 flex-col gap-3">
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-meta">
          <dt className="text-ink-muted">Shown in the app</dt>
          <dd className="m-0 font-mono text-ink">{name}</dd>
          {security === 2 && (
            <>
              <dt className="text-ink-muted">Username</dt>
              <dd className="m-0 break-all font-mono text-ink">{username}</dd>
            </>
          )}
          <dt className="text-ink-muted">{security === 2 ? "Password" : "PoP"}</dt>
          <dd className="m-0 text-ink">the device&apos;s password (in the QR)</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={downloadLabel}>
            <Download aria-hidden size={14} /> Download label
          </Button>
          <Button size="sm" variant="secondary" onClick={printLabel}>
            <Printer aria-hidden size={14} /> Print label
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copyPayload()}>
            <Copy aria-hidden size={14} /> Copy payload
          </Button>
        </div>
        <p className="text-xs text-ink-muted">
          The QR holds this device&apos;s password, so keep a printed label like a key. It works until the credential is rotated; rotating makes a new sketch
          and a new QR.
        </p>
      </div>
    </div>
  );
}
