"use client";

import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { InstallStep } from "@/components/devices/InstallStep";
import { SerialMonitor, StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow, InstallPath } from "@/components/devices/connect/useConnectFlow";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

/** Step 3: Install the generic firmware from the browser, or get the sketch.
 * A wired device keeps the sketch under "Advanced". */
export function FirmwareStep({ flow }: { flow: ConnectFlow }) {
  const { install, phone } = flow;
  return (
    <>
      <h2 className="text-section font-semibold text-ink">{install ? tr("connect2.install") : tr("connect2.flash")}</h2>
      {install ? <InstallBlock flow={flow} install={install} /> : <SketchBlock flow={flow} />}
      {!phone && <SerialMonitor flow={flow} />}
      <StepNav
        state={install ? tr("connect2.installState") : tr("connect2.flashState")}
        onBack={() => flow.setStep(2)}
        onNext={() => flow.setStep(phone ? 4 : 5)}
      />
    </>
  );
}

function InstallBlock({ flow, install }: { flow: ConnectFlow; install: InstallPath }) {
  const { device, phone, toast } = flow;
  return (
    <>
      <p className="text-sm text-ink-muted">
        {richT(tr, "connect2.installsLead", { board: <b className="text-ink">{install.model.label}</b> }, { version: install.firmware.version, device: device.name })}
      </p>
      <InstallStep
        config={install.config}
        model={install.model}
        manifest={install.firmware.manifest}
        onInstalled={(mode) => {
          if (mode !== "full") return;
          toast({ title: tr("connect2.installed"), detail: phone ? tr("connect2.installedPhone") : tr("connect2.installedWifi") });
          flow.setStep(phone ? 4 : 5);
        }}
      />
      <details className="overflow-hidden rounded-lg border border-border">
        <summary className="cursor-pointer bg-surface-raised px-3 py-2 text-meta text-ink">{tr("connect2.downloadInstead")}</summary>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-xs text-ink-muted">
            {tr("connect2.customCode")}
          </p>
          <SketchBlock flow={flow} />
        </div>
      </details>
    </>
  );
}

function SketchBlock({ flow }: { flow: ConnectFlow }) {
  const { device, credential, boardInfo, sketchBoard, phone, security, ssid, blocked, install, sketchFor, toast } = flow;

  async function copySketch() {
    try {
      await navigator.clipboard.writeText(sketchFor(credential));
      toast({ title: tr("connect2.sketchCopied"), detail: tr("connect2.sketchCopiedDetail") });
    } catch {
      toast({ tone: "error", title: tr("connect2.clipboard"), detail: tr("connect2.clipboardDetail") });
    }
  }

  function downloadSketch() {
    const blob = new Blob([sketchFor(credential)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${device.slug.replace(/[^a-zA-Z0-9_-]/g, "_")}.ino`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <p className="text-sm text-ink-muted">
        {richT(tr, "connect2.sketchFor", { board: <b className="text-ink">{boardInfo.label}</b> }, { wifi: phone ? tr("connect2.sketchPhone", { security }) : tr("connect2.sketchSsid", { ssid }) })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={install ? "secondary" : "primary"} disabled={blocked} onClick={downloadSketch}>
          <Download aria-hidden size={15} />
          {tr("connect2.download", { file: `${device.slug}.ino` })}
        </Button>
        <Button variant="secondary" disabled={blocked} onClick={() => void copySketch()}>
          <Copy aria-hidden size={14} />
          {tr("connect2.copySketch")}
        </Button>
      </div>
      <details className="overflow-hidden rounded-lg border border-border">
        <summary className="cursor-pointer bg-surface-raised px-3 py-2 text-meta text-ink">
          {tr("connect2.preview")} <span className="text-ink-muted">· {tr("connect2.previewMeta", { lines: sketchFor(null).split("\n").length })}</span>
        </summary>
        <pre aria-label={tr("connect2.generated")} className="max-h-[520px] overflow-auto bg-canvas p-3 font-mono text-xs leading-[1.55] text-ink">
          <code>{sketchFor(credential ? { username: credential.username, password: "••••••••" } : null)}</code>
        </pre>
      </details>
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">{tr("connect2.uploadIde")}</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>{tr("connect2.ide1")}</li>
          <li>{tr("connect2.ide2")}</li>
          <li>
            Tools → Board → <b>{boardInfo.arduinoBoard}</b>.
          </li>
          {boardInfo.ideSettings.map((s) => (
            <li key={s}>
              Tools → <b>{s}</b>.
            </li>
          ))}
          {phone && (
            <li>
              Tools → Partition Scheme → <b>Huge APP (3MB No OTA/1MB SPIFFS)</b>. {tr("connect2.ideHuge")}
            </li>
          )}
          {phone && sketchBoard === "esp32" && (
            <li>
              {richT(tr, "connect2.ideButton", { pin: <b>GPIO 19</b>, gnd: <b>GND</b> })}
            </li>
          )}
          <li>{tr("connect2.ideUpload")}</li>
          <li>
            {richT(tr, "connect2.ideSerial", { baud: <b>115200 baud</b> })}
          </li>
        </ol>
        <p className="mt-2 text-xs text-ink-muted">
          {richT(tr, "connect2.pio", { board: <code className="font-mono">board = {boardInfo.pioBoard}</code> })}
        </p>
      </div>
    </>
  );
}
