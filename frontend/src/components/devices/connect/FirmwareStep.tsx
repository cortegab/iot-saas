"use client";

import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { InstallStep } from "@/components/devices/InstallStep";
import { SerialMonitor, StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow, InstallPath } from "@/components/devices/connect/useConnectFlow";

/** Step 3: Install the generic firmware from the browser, or get the sketch.
 * A wired device keeps the sketch under "Advanced". */
export function FirmwareStep({ flow }: { flow: ConnectFlow }) {
  const { install, phone } = flow;
  return (
    <>
      <h2 className="text-lg font-semibold text-ink">{install ? "Install" : "Flash"}</h2>
      {install ? <InstallBlock flow={flow} install={install} /> : <SketchBlock flow={flow} />}
      {!phone && <SerialMonitor flow={flow} />}
      <StepNav onBack={() => flow.setStep(2)} onNext={() => flow.setStep(phone ? 4 : 5)} />
    </>
  );
}

function InstallBlock({ flow, install }: { flow: ConnectFlow; install: InstallPath }) {
  const { device, phone, toast } = flow;
  return (
    <>
      <p className="text-sm text-ink-muted">
        Installs firmware {install.firmware.version} and {device.name}&apos;s settings on the <b className="text-ink">{install.model.label}</b>, straight from
        this page. About a minute.
      </p>
      <InstallStep
        config={install.config}
        model={install.model}
        manifest={install.firmware.manifest}
        onInstalled={(mode) => {
          if (mode !== "full") return;
          toast({ title: "Firmware installed", detail: phone ? "Now give it Wi-Fi from your phone." : "It's joining your Wi-Fi." });
          flow.setStep(phone ? 4 : 5);
        }}
      />
      <details className="overflow-hidden rounded-lg border border-border">
        <summary className="cursor-pointer bg-surface-raised px-3 py-2 text-[13px] text-ink">Advanced: download the sketch instead</summary>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-xs text-ink-muted">
            For custom code. The sketch uses its own default pins, not the wiring above, and publishes numbers only once you add your sensor
            code.
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
      toast({ title: "Sketch copied", detail: "It includes the full credential." });
    } catch {
      toast({ tone: "error", title: "Couldn't reach the clipboard", detail: "Select the text and copy it with Ctrl+C." });
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
        Your sketch for <b className="text-ink">{boardInfo.label}</b>
        {phone ? `, Wi-Fi from a phone (Security ${security} – PoP)` : `, Wi-Fi "${ssid}"`}. Download it, add your sensor code, and upload it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={install ? "secondary" : "primary"} disabled={blocked} onClick={downloadSketch}>
          <Download aria-hidden size={15} />
          Download {device.slug}.ino
        </Button>
        <Button variant="secondary" disabled={blocked} onClick={() => void copySketch()}>
          <Copy aria-hidden size={14} />
          Copy sketch
        </Button>
      </div>
      <details className="overflow-hidden rounded-lg border border-border">
        <summary className="cursor-pointer bg-surface-raised px-3 py-2 text-[13px] text-ink">
          Preview the sketch <span className="text-ink-muted">· {sketchFor(null).split("\n").length} lines, password masked</span>
        </summary>
        <pre aria-label="Generated sketch" className="max-h-[520px] overflow-auto bg-canvas p-3 font-mono text-[12px] leading-[1.55] text-ink">
          <code>{sketchFor(credential ? { username: credential.username, password: "••••••••" } : null)}</code>
        </pre>
      </details>
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Upload with Arduino IDE</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>Boards Manager: ESP32 by Espressif, version 3.x. Library Manager: PubSubClient, ArduinoJson.</li>
          <li>Plug the board in over USB.</li>
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
              Tools → Partition Scheme → <b>Huge APP (3MB No OTA/1MB SPIFFS)</b>. BLE and Wi-Fi don&apos;t fit the default.
            </li>
          )}
          {phone && sketchBoard === "esp32" && (
            <li>
              Wire a push button between <b>GPIO 19</b> and <b>GND</b> (optional). Holding it for 5 seconds clears the Wi-Fi so you can set a new one.
            </li>
          )}
          <li>Open the sketch, add your sensor code, and select Upload.</li>
          <li>
            Open the Serial Monitor at <b>115200 baud</b>.
          </li>
        </ol>
        <p className="mt-2 text-xs text-ink-muted">
          PlatformIO works too: <code className="font-mono">board = {sketchBoard === "esp32c3" ? "esp32-c3-devkitm-1" : "esp32dev"}</code>, same libraries.
        </p>
      </div>
    </>
  );
}
