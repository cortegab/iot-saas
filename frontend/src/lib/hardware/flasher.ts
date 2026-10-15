/** Flashing the generic firmware (firmware/) from the browser, over Web Serial.
 *
 * The binaries are static files a release publishes under /firmware/
 * (firmware/release.py); nothing is compiled per device. A full install writes
 * bootloader + partition table + otadata + app + the device's config blob; a
 * config-only update rewrites just the `cfg` partition, keeping the app and the
 * Wi-Fi the board already has. Chrome/Edge on desktop only (Web Serial). */
import type { SketchBoard } from "@/lib/firmware-sketch";
import type { BoardModel, DriverSpec } from "@/lib/hardware/driver-catalog";

export const FIRMWARE_BASE = "/firmware";

export interface ManifestPart {
  path: string;
  offset: number;
  size: number;
  sha256: string;
}

export interface FirmwareManifest {
  version: string;
  built_at: string;
  /** One build per chip, keyed by chip (a board model's `chip`). */
  boards: Record<
    SketchBoard,
    {
      /** The chip name esptool reports, to catch the wrong board being plugged in. */
      chip: string;
      parts: ManifestPart[];
      app: { offset: number; size: number; used: number };
      cfg: { offset: number; size: number };
      /** Where saved Wi-Fi lives. Missing from releases before 0.3.1. */
      nvs?: { offset: number; size: number };
    }
  >;
  /** The board models people pick (firmware/boards.json). Missing from
   * releases before 0.2.0. */
  models?: BoardModel[];
  /** The driver catalog (firmware/drivers.json) this build supports. */
  drivers: DriverSpec[];
}

export type FlashStage = "connecting" | "downloading" | "writing" | "restarting" | "done";

export interface FlashProgress {
  stage: FlashStage;
  /** While writing: which file and how far. */
  file?: string;
  written?: number;
  total?: number;
}

export interface FlashTimings {
  connectMs: number;
  downloadMs: number;
  writeMs: number;
  totalMs: number;
  bytes: number;
  /** Whether the saved Wi-Fi was erased (full mode with eraseWifi). */
  wifiErased: boolean;
  /** Anything skipped, in words (e.g. a release too old to erase Wi-Fi). */
  notes: string[];
}

export function webSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export async function loadManifest(base = FIRMWARE_BASE): Promise<FirmwareManifest> {
  const latest = await fetchJson<{ manifest: string }>(`${base}/latest.json`);
  return fetchJson<FirmwareManifest>(`${base}/${latest.manifest}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status}). Is a firmware release published?`);
  return (await res.json()) as T;
}

async function fetchPart(base: string, version: string, part: ManifestPart): Promise<Uint8Array> {
  const res = await fetch(`${base}/${version}/${part.path}`);
  if (!res.ok) throw new Error(`Couldn't download ${part.path} (${res.status}).`);
  const data = new Uint8Array(await res.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== part.sha256) throw new Error(`${part.path} is corrupt (checksum mismatch). Reload and try again.`);
  return data;
}

export interface FlashOptions {
  manifest: FirmwareManifest;
  board: SketchBoard;
  /** "full": first install or firmware update. "config": only the cfg partition. */
  mode: "full" | "config";
  /** The encoded config (encodeConfigBlob), written to the cfg partition. */
  configBlob: Uint8Array;
  /** Full mode only: blank the saved Wi-Fi too, so the board starts at phone
   * setup. A config-only update always keeps it. */
  eraseWifi?: boolean;
  /** From navigator.serial.requestPort(), which needs the click's user gesture:
   * call it in the click handler before any other await. */
  port: SerialPort;
  baudrate?: number;
  base?: string;
  onProgress?: (p: FlashProgress) => void;
  onLog?: (line: string) => void;
}

export interface FlashFile {
  name: string;
  data: Uint8Array;
  address: number;
}

/** What gets written, in order: the firmware parts (full mode), a blank NVS
 * when the Wi-Fi is to be erased (0xFF is an empty NVS, which the firmware
 * re-initialises), then the device config. `notes` explains anything skipped. */
export function flashFiles(
  target: FirmwareManifest["boards"][SketchBoard],
  opts: { mode: "full" | "config"; parts: FlashFile[]; configBlob: Uint8Array; eraseWifi?: boolean },
): { files: FlashFile[]; notes: string[] } {
  const files: FlashFile[] = opts.mode === "full" ? [...opts.parts] : [];
  const notes: string[] = [];
  if (opts.mode === "full" && opts.eraseWifi) {
    if (target.nvs) files.push({ name: "saved Wi-Fi (erased)", data: new Uint8Array(target.nvs.size).fill(0xff), address: target.nvs.offset });
    else notes.push("This firmware release doesn't say where the saved Wi-Fi is, so it was kept.");
  }
  files.push({ name: "device config", data: opts.configBlob, address: target.cfg.offset });
  return { files, notes };
}

/** A failed flash: where it failed, a message a person can act on, and whether
 * trying again at a lower speed could help (only a transfer that dropped). */
export class FlashError extends Error {
  constructor(
    message: string,
    readonly stage: FlashStage,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FlashError";
  }
}

/** A raw Web Serial / esptool-js failure, in words. `synced`: the board's
 * bootloader had answered (its chip was identified) before it failed. */
export function explainFlashError(err: unknown, stage: FlashStage, synced = false): FlashError {
  if (err instanceof FlashError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (/failed to open serial port|port is already open/i.test(raw) || name === "InvalidStateError")
    return new FlashError(
      "The board's COM port is busy. Close any serial monitor using it (Arduino IDE, PuTTY, pio device monitor), then try again. If none is open, unplug the board and plug it in again.",
      stage,
      false,
    );
  if (/device has been lost|disconnected/i.test(raw) || name === "NetworkError")
    return new FlashError("The board disconnected. Check the USB cable, plug the board in again, and try again.", stage, false);
  if (stage === "connecting" && synced)
    return new FlashError(
      "The board answered, then stopped responding. Unplug anything wired to GPIO 0, 2, 12 or 15, use a USB port on the computer itself (not a hub), and try again.",
      stage,
      false,
    );
  if (stage === "connecting")
    return new FlashError(
      "The board didn't answer. Hold its BOOT button while you click Install, and let go once the progress starts.",
      stage,
      false,
    );
  return new FlashError(raw, stage, stage === "writing");
}

/** The ROM bootloader's own speed: always works once the board answers. */
const ROM_BAUDRATE = 115200;
const LOG_LINES = 80;

/** Flashes the board on `port` and restarts it. Throws a FlashError with a
 * message a person can act on; the port is always released. */
export async function flashBoard(opts: FlashOptions): Promise<FlashTimings> {
  const { manifest, board, mode, configBlob, port, baudrate = 921600, base = FIRMWARE_BASE } = opts;
  const target = manifest.boards[board];
  if (!target) throw new Error(`Firmware ${manifest.version} has no build for ${board}.`);
  if (configBlob.length > target.cfg.size) throw new Error("The device config is larger than the board's config area.");

  // esptool-js touches `window` at import; load it only when flashing.
  const { ESPLoader, Transport } = await import("esptool-js");
  let stage: FlashStage = "connecting";
  const report = opts.onProgress ?? (() => {});
  const progress = (p: FlashProgress) => {
    stage = p.stage;
    report(p);
  };
  // The last lines of esptool's log, printed to the console when it fails, so
  // a failed install can be diagnosed from the browser's dev tools.
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    if (lines.length > LOG_LINES) lines.shift();
    opts.onLog?.(line);
  };
  const terminal = { clean: () => {}, write: log, writeLine: log };
  let transport = new Transport(port, false);
  let synced = false;
  const t0 = performance.now();

  try {
    progress({ stage: "connecting" });
    // esptool's main() also loads its stub and switches to `baudrate`. Some
    // USB-serial bridges (cheap CP2102/CH340 boards, long cables) answer at
    // 115200 but drop at 921600; then it reconnects once at 115200.
    let loader = new ESPLoader({ transport, baudrate, terminal });
    try {
      await loader.main();
    } catch (err) {
      synced = loader.chip != null;
      if (!synced || baudrate <= ROM_BAUDRATE) throw err;
      log(`Lost the board at ${baudrate} baud; trying again at ${ROM_BAUDRATE}.`);
      await transport.disconnect().catch(() => {});
      transport = new Transport(port, false);
      loader = new ESPLoader({ transport, baudrate: ROM_BAUDRATE, terminal });
      await loader.main();
    }
    synced = true;
    const chip = loader.chip.CHIP_NAME;
    if (chip !== target.chip) {
      throw new FlashError(`This board is an ${chip}, but you picked ${target.chip}. Pick the matching board and try again.`, stage, false);
    }
    const t1 = performance.now();

    progress({ stage: "downloading" });
    const parts =
      mode === "full"
        ? await Promise.all(
            target.parts.map(async (part) => ({ name: part.path, data: await fetchPart(base, manifest.version, part), address: part.offset })),
          )
        : [];
    const { files, notes } = flashFiles(target, { mode, parts, configBlob, eraseWifi: opts.eraseWifi });
    notes.forEach(log);
    const t2 = performance.now();

    await loader.writeFlash({
      fileArray: files.map(({ data, address }) => ({ data, address })),
      flashSize: "keep",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (i, written, total) => progress({ stage: "writing", file: files[i]?.name, written, total }),
    });
    const t3 = performance.now();

    progress({ stage: "restarting" });
    await loader.after("hard_reset");
    progress({ stage: "done" });
    return {
      connectMs: t1 - t0,
      downloadMs: t2 - t1,
      writeMs: t3 - t2,
      totalMs: performance.now() - t0,
      bytes: files.reduce((n, f) => n + f.data.length, 0),
      wifiErased: files.some((f) => target.nvs != null && f.address === target.nvs.offset),
      notes,
    };
  } catch (err) {
    console.warn(`Install failed while ${stage}. esptool log:\n${lines.join("\n")}`);
    throw explainFlashError(err, stage, synced);
  } finally {
    await transport.disconnect().catch(() => {});
  }
}
