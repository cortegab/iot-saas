/** Flashing the generic firmware (firmware/) from the browser, over Web Serial.
 *
 * The binaries are static files a release publishes under /firmware/
 * (firmware/release.py); nothing is compiled per device. A full install writes
 * bootloader + partition table + otadata + app + the device's config blob; a
 * config-only update rewrites just the `cfg` partition, keeping the app and the
 * Wi-Fi the board already has. Chrome/Edge on desktop only (Web Serial). */
import type { SketchBoard } from "@/lib/firmware-sketch";

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
  boards: Record<
    SketchBoard,
    {
      /** The chip name esptool reports, to catch the wrong board being plugged in. */
      chip: string;
      parts: ManifestPart[];
      app: { offset: number; size: number; used: number };
      cfg: { offset: number; size: number };
    }
  >;
  /** The driver catalog (firmware/drivers.json) this build supports. */
  drivers: unknown[];
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
  /** From navigator.serial.requestPort(), which needs the click's user gesture:
   * call it in the click handler before any other await. */
  port: SerialPort;
  baudrate?: number;
  base?: string;
  onProgress?: (p: FlashProgress) => void;
  onLog?: (line: string) => void;
}

/** Flashes the board on `port` and restarts it. Throws with a message a person
 * can act on; the port is always released. */
export async function flashBoard(opts: FlashOptions): Promise<FlashTimings> {
  const { manifest, board, mode, configBlob, port, baudrate = 921600, base = FIRMWARE_BASE } = opts;
  const target = manifest.boards[board];
  if (!target) throw new Error(`Firmware ${manifest.version} has no build for ${board}.`);
  if (configBlob.length > target.cfg.size) throw new Error("The device config is larger than the board's config area.");

  // esptool-js touches `window` at import; load it only when flashing.
  const { ESPLoader, Transport } = await import("esptool-js");
  const progress = opts.onProgress ?? (() => {});
  const log = opts.onLog ?? (() => {});
  const terminal = { clean: () => {}, write: log, writeLine: log };
  const transport = new Transport(port, false);
  const t0 = performance.now();

  try {
    progress({ stage: "connecting" });
    const loader = new ESPLoader({ transport, baudrate, terminal });
    await loader.main();
    const chip = loader.chip.CHIP_NAME;
    if (chip !== target.chip) {
      throw new Error(`This board is an ${chip}, but you picked ${target.chip}. Pick the matching board and try again.`);
    }
    const t1 = performance.now();

    progress({ stage: "downloading" });
    const files =
      mode === "full"
        ? await Promise.all(
            target.parts.map(async (part) => ({ name: part.path, data: await fetchPart(base, manifest.version, part), address: part.offset })),
          )
        : [];
    files.push({ name: "device config", data: configBlob, address: target.cfg.offset });
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
    };
  } finally {
    await transport.disconnect().catch(() => {});
  }
}
