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
      /** The driver ids this build carries. Missing from releases before
       * 0.7.0, which carried every driver; the dashboard filters by each
       * driver's `chips`, which says the same. */
      drivers?: string[];
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
  /** While writing: how far the whole write is, 0–1 (overallFraction). */
  fraction?: number;
  /** The link speed of this attempt; below BAUD_LADDER[0] after a drop. */
  baudrate: number;
}

export interface FlashTimings {
  connectMs: number;
  downloadMs: number;
  writeMs: number;
  totalMs: number;
  bytes: number;
  /** The link speed that finished the job. */
  baudrate: number;
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
  /** Where to start on BAUD_LADDER; a speed that worked before on this port wins. */
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

/** Link speeds, fastest first. A board that answers but drops out steps down
 * one rung at a time; 115200 is the ROM bootloader's own speed, which always
 * works once the board answers. */
export const BAUD_LADDER = [921600, 460800, 115200] as const;
const LOG_LINES = 80;

/** The next slower speed after `baud`, or null at the bottom of the ladder. */
export function nextSlower(baud: number): number | null {
  return BAUD_LADDER.find((b) => b < baud) ?? null;
}

/** After a failed attempt at `baud`: the speed to try next, or null to give
 * up. Only a board that answered and then dropped (while connecting), or a
 * transfer that dropped (while writing), is worth a slower try; a board that
 * never answered, a busy port or the wrong board isn't. */
export function nextAttempt(f: { stage: FlashStage; synced: boolean; retryable: boolean; baud: number }): number | null {
  const dropped = (f.stage === "connecting" && f.synced) || (f.stage === "writing" && f.retryable);
  return dropped ? nextSlower(f.baud) : null;
}

/** How far the whole write is (0–1): esptool reports per file, so each file
 * counts by its size. */
export function overallFraction(sizes: number[], index: number, written: number, total: number): number {
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  const all = sum(sizes);
  if (all <= 0) return 1;
  const part = total > 0 ? Math.min(1, written / total) : 1;
  return Math.min(1, (sum(sizes.slice(0, index)) + (sizes[index] ?? 0) * part) / all);
}

/** The release build for the chip esptool reports ("ESP32-C3"), if any. */
export function chipForName(manifest: Pick<FirmwareManifest, "boards">, chipName: string): SketchBoard | null {
  const hit = Object.entries(manifest.boards).find(([, b]) => b.chip === chipName);
  return hit ? (hit[0] as SketchBoard) : null;
}

/** "Detect my board" (DESIGN.md §8): asks the board on `port` which chip it is
 * and restarts it, writing nothing. Returns esptool's chip name ("ESP32-C3").
 * Boards with the same chip look alike, so this narrows the model list; the
 * person still picks the model. Throws a FlashError a person can act on. */
export async function detectChip(port: SerialPort): Promise<string> {
  const { ESPLoader, Transport } = await import("esptool-js");
  const quiet = { clean: () => {}, write: () => {}, writeLine: () => {} };
  const transport = new Transport(port, false);
  let loader: InstanceType<typeof ESPLoader> | null = null;
  try {
    loader = new ESPLoader({ transport, baudrate: 115200, terminal: quiet });
    await loader.main();
    const name = loader.chip.CHIP_NAME;
    await loader.after("hard_reset");
    return name;
  } catch (err) {
    throw explainFlashError(err, "connecting", loader?.chip != null);
  } finally {
    await transport.disconnect().catch(() => {});
  }
}

// The speed that last worked for each plugged-in board (Chrome keeps the same
// SerialPort until it's unplugged), so a board that drops at full speed
// doesn't pay for the failed attempts again. Forgotten on reload.
const goodBaud = new WeakMap<SerialPort, number>();

/** Flashes the board on `port` and restarts it, stepping down BAUD_LADDER when
 * the link drops. Throws a FlashError with a message a person can act on; the
 * port is always released. */
export async function flashBoard(opts: FlashOptions): Promise<FlashTimings> {
  const { manifest, board, mode, configBlob, port, base = FIRMWARE_BASE } = opts;
  const target = manifest.boards[board];
  if (!target) throw new Error(`Firmware ${manifest.version} has no build for ${board}.`);
  if (configBlob.length > target.cfg.size) throw new Error("The device config is larger than the board's config area.");

  // esptool-js touches `window` at import; load it only when flashing.
  const { ESPLoader, Transport } = await import("esptool-js");
  const report = opts.onProgress ?? (() => {});
  // The last lines of esptool's log, printed to the console when it fails, so
  // a failed install can be diagnosed from the browser's dev tools.
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    if (lines.length > LOG_LINES) lines.shift();
    opts.onLog?.(line);
  };
  const terminal = { clean: () => {}, write: log, writeLine: log };
  const t0 = performance.now();
  // Downloaded once, however many attempts it takes.
  let parts: FlashFile[] | null = null;
  let baud = goodBaud.get(port) ?? opts.baudrate ?? BAUD_LADDER[0];

  for (;;) {
    let stage: FlashStage = "connecting";
    let synced = false;
    const progress = (p: Omit<FlashProgress, "baudrate">) => {
      stage = p.stage;
      report({ ...p, baudrate: baud });
    };
    const transport = new Transport(port, false);
    let loader: InstanceType<typeof ESPLoader> | null = null;
    const ta = performance.now();
    try {
      progress({ stage: "connecting" });
      // main() also loads esptool's stub and switches to `baud`.
      loader = new ESPLoader({ transport, baudrate: baud, terminal });
      await loader.main();
      synced = true;
      const chip = loader.chip.CHIP_NAME;
      if (chip !== target.chip) {
        throw new FlashError(`This board is an ${chip}, but you picked ${target.chip}. Pick the matching board and try again.`, stage, false);
      }
      const t1 = performance.now();

      progress({ stage: "downloading" });
      parts ??=
        mode === "full"
          ? await Promise.all(
              target.parts.map(async (part) => ({ name: part.path, data: await fetchPart(base, manifest.version, part), address: part.offset })),
            )
          : [];
      const { files, notes } = flashFiles(target, { mode, parts, configBlob, eraseWifi: opts.eraseWifi });
      notes.forEach(log);
      const sizes = files.map((f) => f.data.length);
      const t2 = performance.now();

      await loader.writeFlash({
        fileArray: files.map(({ data, address }) => ({ data, address })),
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (i, written, total) =>
          progress({ stage: "writing", file: files[i]?.name, written, total, fraction: overallFraction(sizes, i, written, total) }),
      });
      const t3 = performance.now();

      progress({ stage: "restarting" });
      await loader.after("hard_reset");
      progress({ stage: "done" });
      goodBaud.set(port, baud);
      return {
        connectMs: t1 - ta,
        downloadMs: t2 - t1,
        writeMs: t3 - t2,
        totalMs: performance.now() - t0,
        bytes: files.reduce((n, f) => n + f.data.length, 0),
        baudrate: baud,
        wifiErased: files.some((f) => target.nvs != null && f.address === target.nvs.offset),
        notes,
      };
    } catch (err) {
      synced ||= loader?.chip != null;
      const failure = explainFlashError(err, stage, synced);
      // Our own FlashErrors (the wrong board) are final.
      const next = err instanceof FlashError ? null : nextAttempt({ stage, synced, retryable: failure.retryable, baud });
      if (next == null) {
        console.warn(`Install failed while ${stage} at ${baud} baud. esptool log:\n${lines.join("\n")}`);
        throw failure;
      }
      log(`Lost the board at ${baud} baud while ${stage}; trying again at ${next}.`);
      baud = next;
    } finally {
      await transport.disconnect().catch(() => {});
    }
  }
}
