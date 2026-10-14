"use client";

import { useEffect, useState } from "react";
import { Check, Cpu, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { encodeConfigBlob, type FirmwareConfig } from "@/lib/hardware/config-blob";
import type { BoardModel } from "@/lib/hardware/driver-catalog";
import { FlashError, flashBoard, webSerialSupported, type FirmwareManifest, type FlashProgress, type FlashTimings } from "@/lib/hardware/flasher";

type Mode = "full" | "config";

const STAGE_LABEL: Record<FlashProgress["stage"], string> = {
  connecting: "Connecting to the board…",
  downloading: "Downloading the firmware…",
  writing: "Writing",
  restarting: "Restarting the board…",
  done: "Done",
};

/**
 * The Connect flow's Install step (DESIGN.md §8): flashes the generic firmware
 * plus this device's config over USB, from the browser (Web Serial). A first
 * install also erases the board's saved Wi-Fi, so it starts at phone setup;
 * "Update config only" rewrites just the config and keeps the Wi-Fi.
 * `config` is null until everything it needs is ready (credential, Security 2
 * verifier, broker host).
 */
export function InstallStep({
  config,
  model,
  manifest,
  onInstalled,
}: {
  config: FirmwareConfig | null;
  model: BoardModel;
  manifest: FirmwareManifest;
  onInstalled: (mode: Mode) => void;
}) {
  // Unknown until mounted: deciding during render would differ between the
  // server (no navigator) and the browser.
  const [serialOk, setSerialOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [done, setDone] = useState<{ mode: Mode; timings: FlashTimings } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSerialOk(webSerialSupported()), []);

  const target = manifest.boards[model.chip];

  async function install(mode: Mode) {
    if (!config) return;
    setError(null);
    setDone(null);
    // The port picker needs this click's user gesture: ask before any await.
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      return; // picker closed
    }
    setBusy(mode);
    const blob = encodeConfigBlob(config, target.cfg.size);
    const attempt = (baudrate: number) =>
      flashBoard({ manifest, board: model.chip, mode, configBlob: blob, port, baudrate, eraseWifi: mode === "full", onProgress: setProgress });
    try {
      let timings: FlashTimings;
      try {
        timings = await attempt(921600);
      } catch (first) {
        // Some USB-serial chips (CH340 especially) drop out at full speed
        // mid-transfer: one retry at half speed. Pointless for a busy port,
        // a board that didn't answer or the wrong board, so only for those
        // FlashError marks retryable.
        if (!(first instanceof FlashError && first.retryable)) throw first;
        timings = await attempt(460800);
      }
      setDone({ mode, timings });
      onInstalled(mode);
    } catch (err) {
      // A FlashError already says what to do; anything else gets the usual hint.
      setError(
        err instanceof FlashError
          ? err.message
          : `${(err as Error).message} If the board wouldn't connect, hold its BOOT button while you click Install, then try again.`,
      );
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const progressText =
    progress &&
    `${STAGE_LABEL[progress.stage]}${progress.stage === "writing" && progress.total ? ` ${progress.file}: ${Math.round(((progress.written ?? 0) / progress.total) * 100)}%` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      {serialOk === false && (
        <Callout tone="warning" title="This browser can't install firmware">
          Installing over USB needs Chrome or Edge on a computer. Open this page there, or download the sketch below and upload it with the Arduino
          IDE.
        </Callout>
      )}

      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Before you install</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          <li>
            Plug the <b>{model.label}</b> in with a USB <b>data</b> cable (charge-only cables don&apos;t work).
          </li>
          <li>If no port shows up, install the board&apos;s USB driver (CP210x or CH340) and plug it in again.</li>
          {(model.notes ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>Installing erases the Wi-Fi the board has saved, so it starts at phone setup.</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!config || busy != null || !serialOk} onClick={() => void install("full")}>
          {busy === "full" ? <Loader2 aria-hidden size={15} className="animate-spin" /> : <Cpu aria-hidden size={15} />}
          {busy === "full" ? "Installing…" : `Install firmware ${manifest.version}`}
        </Button>
        <Button variant="secondary" disabled={!config || busy != null || !serialOk} onClick={() => void install("config")}>
          <RefreshCw aria-hidden size={14} />
          Update config only
        </Button>
        {progressText && (
          <span className="text-sm text-ink-muted" aria-live="polite">
            {progressText}
          </span>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        Update config only rewrites this device&apos;s settings (pins, credential, broker) on a board that already runs the firmware, and keeps its
        Wi-Fi. It takes a few seconds.
      </p>

      {error && (
        <Callout tone="error" title="The install didn't finish">
          {error}
        </Callout>
      )}
      {done && (
        <Callout title={done.mode === "full" ? "Firmware installed" : "Config updated"}>
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden size={14} className="text-status-online" />
            {done.mode === "full"
              ? done.timings.wifiErased
                ? "The board restarted with no Wi-Fi saved, and its LED blinks slowly while it waits for your phone."
                : "The board restarted. It kept the Wi-Fi it had."
              : "The board restarted with the new settings and kept its Wi-Fi."}{" "}
            Took {(done.timings.totalMs / 1000).toFixed(0)} s.
          </span>
          {done.timings.notes.map((n) => (
            <span key={n} className="mt-1 block text-xs text-ink-muted">
              {n}
            </span>
          ))}
        </Callout>
      )}
    </div>
  );
}
