"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { encodeConfigBlob, type FirmwareConfig } from "@/lib/hardware/config-blob";
import { flashBoard, loadManifest, webSerialSupported, type FirmwareManifest, type FlashProgress, type FlashTimings } from "@/lib/hardware/flasher";
import type { SketchBoard } from "@/lib/firmware-sketch";

const EXAMPLE: FirmwareConfig = {
  v: 1,
  board: "esp32",
  device: { tenant: "demo", device: "sensor01" },
  mqtt: { host: "192.168.1.10", port: 1883, tls: false, username: "<device id>", password: "<credential>" },
  prov: { name: "sensor01", security: 1 },
  metrics: [
    { key: "door", bool: true, publish: "on_change" },
    { key: "level", publish: "periodic", interval_s: 10 },
  ],
  actuators: [{ key: "fan1", type: "bool" }],
  inputs: [
    { driver: "digital_in", pins: { pin: 13 }, params: { pull: "up" }, channels: { value: "door" } },
    { driver: "analog_in", pins: { pin: 34 }, params: { scale: 1 }, channels: { value: "level" } },
  ],
  outputs: [{ driver: "relay", pins: { pin: 23 }, params: { active_low: true }, channels: { value: "fan1" } }],
};

/** Dev-only bench page for the browser flasher (plan step 1): flash the
 * published generic firmware plus a hand-written config, and time it. The real
 * flow lives in the device's Connect page. */
export function FlashSpike() {
  const [manifest, setManifest] = useState<FirmwareManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [board, setBoard] = useState<SketchBoard>("esp32");
  const [mode, setMode] = useState<"full" | "config">("full");
  const [baud, setBaud] = useState(921600);
  const [json, setJson] = useState(JSON.stringify(EXAMPLE, null, 2));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [timings, setTimings] = useState<FlashTimings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    loadManifest().then(setManifest, (e: Error) => setLoadError(e.message));
  }, []);

  async function flash() {
    setError(null);
    setTimings(null);
    setLog([]);
    let blob: Uint8Array;
    try {
      const config = { ...(JSON.parse(json) as FirmwareConfig), board };
      blob = encodeConfigBlob(config, manifest!.boards[board].cfg.size);
    } catch (e) {
      setError(`Config: ${(e as Error).message}`);
      return;
    }
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      return; // picker closed
    }
    setBusy(true);
    try {
      const t = await flashBoard({
        manifest: manifest!,
        board,
        mode,
        configBlob: blob,
        port,
        baudrate: baud,
        onProgress: setProgress,
        onLog: (line) => setLog((l) => [...l.slice(-200), line]),
      });
      setTimings(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const app = manifest?.boards[board]?.app;
  return (
    <div className="flex flex-col gap-4">
      {!webSerialSupported() && (
        <Callout tone="warning" title="This browser can't flash">
          Web Serial needs Chrome or Edge on a computer.
        </Callout>
      )}
      {loadError && <Callout tone="error">{loadError} Run <code>python3 firmware/release.py --dev</code>.</Callout>}
      <Card>
        <CardHeader
          title="Firmware"
          description={
            manifest
              ? `${manifest.version}, built ${manifest.built_at}${app ? ` · app ${(app.used / 1024).toFixed(0)} KB of ${(app.size / 1024).toFixed(0)} KB (${((app.used / app.size) * 100).toFixed(0)}%)` : ""}`
              : "Loading the manifest…"
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Board">
            <Select value={board} onChange={(e) => setBoard(e.target.value as SketchBoard)}>
              <option value="esp32">ESP32</option>
              <option value="esp32c3">ESP32-C3</option>
            </Select>
          </Field>
          <Field label="Write">
            <Select value={mode} onChange={(e) => setMode(e.target.value as "full" | "config")}>
              <option value="full">Firmware + config</option>
              <option value="config">Config only</option>
            </Select>
          </Field>
          <Field label="Baud rate" hint="Lower it if a CH340 board fails partway.">
            <Select value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
              <option value={921600}>921600</option>
              <option value={460800}>460800</option>
              <option value={115200}>115200</option>
            </Select>
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Device config" description="Written to the cfg partition. The board field follows the picker above." />
        <Textarea mono rows={18} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!manifest || busy || !webSerialSupported()} onClick={flash}>
          {busy ? "Flashing…" : "Connect and flash"}
        </Button>
        {progress && (
          <span className="text-sm text-ink-muted">
            {progress.stage}
            {progress.stage === "writing" && progress.total ? ` ${progress.file} ${Math.round(((progress.written ?? 0) / progress.total) * 100)}%` : ""}
          </span>
        )}
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      {timings && (
        <Callout title="Flashed">
          Connect {(timings.connectMs / 1000).toFixed(1)} s · download {(timings.downloadMs / 1000).toFixed(1)} s · write{" "}
          {(timings.writeMs / 1000).toFixed(1)} s · total {(timings.totalMs / 1000).toFixed(1)} s · {(timings.bytes / 1024).toFixed(0)} KB
        </Callout>
      )}
      {log.length > 0 && (
        <pre className="max-h-[320px] overflow-auto rounded-md border border-border bg-canvas p-3 font-mono text-[12px] leading-[1.5] text-ink-muted">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}
