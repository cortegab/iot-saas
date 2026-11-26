"use client";

import { useEffect, useState } from "react";
import { Check, Cpu, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { encodeConfigBlob, type FirmwareConfig } from "@/lib/hardware/config-blob";
import type { BoardModel } from "@/lib/hardware/driver-catalog";
import { BAUD_LADDER, FlashError, flashBoard, webSerialSupported, type FirmwareManifest, type FlashProgress, type FlashTimings } from "@/lib/hardware/flasher";
import { activeLocale, formatNumber, tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

type Mode = "full" | "config";

const STAGE_LABEL: Record<FlashProgress["stage"], string> = {
  get connecting() { return tr("install.connecting"); },
  get downloading() { return tr("install.downloading"); },
  get writing() { return tr("install.writing"); },
  get restarting() { return tr("install.restarting"); },
  get done() { return tr("install.done"); },
};

/** "1:52" from milliseconds. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The Connect flow's Install step (DESIGN.md §8): flashes the generic firmware
 * plus this device's config over USB, from the browser (Web Serial). A first
 * install also erases the board's saved Wi-Fi, so it starts at phone setup;
 * "Update config only" rewrites just the config and keeps the Wi-Fi.
 * `config` is null until everything it needs is ready (credential, broker host).
 * flashBoard steps the link speed down by itself when a board drops out; the
 * progress panel says so, since the slowest speed takes about 2 minutes.
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => setSerialOk(webSerialSupported()), []);
  // The elapsed clock, ticking while an install runs.
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

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
    setStartedAt(Date.now());
    const blob = encodeConfigBlob(config, target.cfg.size);
    try {
      const timings = await flashBoard({ manifest, board: model.chip, mode, configBlob: blob, port, eraseWifi: mode === "full", onProgress: setProgress });
      setDone({ mode, timings });
      onInstalled(mode);
    } catch (err) {
      // A FlashError already says what to do; anything else gets the usual hint.
      setError(
        err instanceof FlashError
          ? err.message
          : tr("install.bootHint", { message: (err as Error).message }),
      );
    } finally {
      setBusy(null);
      setProgress(null);
      setStartedAt(null);
    }
  }

  const writing = progress?.stage === "writing" && progress.fraction != null;
  const pct = writing ? Math.round((progress.fraction ?? 0) * 100) : null;
  const stageText = progress && (progress.stage === "writing" ? tr("install.writingFile", { file: progress.file ?? tr("install.theFirmware") }) : STAGE_LABEL[progress.stage]);
  // Below full speed after the board dropped out: say why it's slow.
  const slower = progress != null && progress.baudrate < BAUD_LADDER[0];

  return (
    <div className="flex flex-col gap-4">
      {serialOk === false && (
        <Callout tone="warning" title={tr("install.noSerialTitle")}>
          {tr("install.noSerial")}
        </Callout>
      )}

      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">{tr("install.before")}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          <li>
            {richT(tr, "install.plug", { board: <b>{model.label}</b>, data: <b>{tr("install.data")}</b> })}
          </li>
          <li>{tr("install.driver")}</li>
          {(model.notes ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>{tr("install.erases")}</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!config || busy != null || !serialOk} onClick={() => void install("full")}>
          {busy === "full" ? <Loader2 aria-hidden size={15} className="animate-spin" /> : <Cpu aria-hidden size={15} />}
          {busy === "full" ? tr("install.installing") : tr("install.installVersion", { version: manifest.version })}
        </Button>
        <Button variant="secondary" disabled={!config || busy != null || !serialOk} onClick={() => void install("config")}>
          <RefreshCw aria-hidden size={14} />
          {tr("install.configOnly")}
        </Button>
      </div>
      {busy && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink" aria-live="polite">
              {stageText ?? STAGE_LABEL.connecting}
            </span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              {pct != null && `${pct}% · `}
              {startedAt != null && clock(now - startedAt)}
            </span>
          </div>
          <ProgressBar
            value={writing ? (progress.fraction ?? 0) : undefined}
            label={busy === "full" ? tr("install.installingLabel") : tr("install.updatingLabel")}
            valueText={pct != null ? `${pct}%` : (stageText ?? undefined)}
          />
          {slower && (
            <p className="text-xs text-ink-muted">
              {tr("install.slower", {
                baud: formatNumber(activeLocale(), progress.baudrate),
                time: tr(progress.baudrate <= BAUD_LADDER[BAUD_LADDER.length - 1] ? "install.about2" : "install.underMinute"),
              })}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-ink-muted">
        {tr("install.configNote")}
      </p>

      {error && (
        <Callout tone="error" title={tr("install.failed")}>
          {error}
        </Callout>
      )}
      {done && (
        <Callout title={done.mode === "full" ? tr("install.installed") : tr("install.configUpdated")}>
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden size={14} className="text-status-online" />
            {done.mode === "full"
              ? done.timings.wifiErased
                ? tr("install.noWifi")
                : tr("install.keptWifi")
              : tr("install.newSettings")}{" "}
            {done.timings.baudrate < BAUD_LADDER[0]
              ? tr("install.tookAt", { time: clock(done.timings.totalMs), baud: formatNumber(activeLocale(), done.timings.baudrate) })
              : tr("install.took", { time: clock(done.timings.totalMs) })}
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
