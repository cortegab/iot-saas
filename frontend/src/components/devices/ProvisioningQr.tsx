"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { Copy, Download, Printer } from "lucide-react";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { provisioningPayload, provName } from "@/lib/firmware-sketch";

const QUIET = 2; // modules of white border around the code

/** The QR modules as one SVG path, in module units. */
function qrPath(payload: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET},${r + QUIET}h1v1h-1z`;
  return { size: n + QUIET * 2, d };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A printable label: the QR with the device name under it. */
function labelSvg(name: string, security: 1 | 2, qr: { size: number; d: string }): string {
  const W = 320;
  const H = 372;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#fff"/>
<svg x="20" y="16" width="280" height="280" viewBox="0 0 ${qr.size} ${qr.size}" shape-rendering="crispEdges"><path d="${qr.d}" fill="#000"/></svg>
<text x="${W / 2}" y="322" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="600" fill="#111">${xml(name)}</text>
<text x="${W / 2}" y="348" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#555">ESP BLE Provisioning · Security ${security}</text>
</svg>`;
}

/**
 * The QR the ESP BLE Provisioning app scans (docs/ble-provisioning.md). Built
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
  const fileBase = name.replace(/[^a-zA-Z0-9_-]+/g, "_");

  function downloadLabel() {
    const blob = new Blob([labelSvg(name, security, qr)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase}-provisioning.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printLabel() {
    const w = window.open("", "_blank", "width=420,height=520");
    if (!w) {
      toast({ tone: "error", title: "The print window was blocked", detail: "Download the label and print it instead." });
      return;
    }
    w.document.write(`<!doctype html><title>${xml(name)}</title><body style="margin:24px">${labelSvg(name, security, qr)}</body>`);
    w.document.close();
    w.focus();
    w.print();
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
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
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
        <p className="text-[12.5px] text-ink-muted">
          The QR holds this device&apos;s password, so keep a printed label like a key. It works until the credential is rotated; rotating makes a new sketch
          and a new QR.
        </p>
      </div>
    </div>
  );
}
