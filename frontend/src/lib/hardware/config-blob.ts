/** The per-device config the generic firmware (firmware/) reads from its `cfg`
 * partition, and the bytes the browser flasher writes there.
 *
 * Layout, little-endian, padded with 0xFF to the partition size:
 *   0 "IOCF" | 4 version u16 = 1 | 6 reserved u16 | 8 length u32 | 12 crc32 u32 | 16 JSON
 * The reader is firmware/src/config.cpp; both are checked against
 * firmware/test/config-vector.json. The JSON carries the plaintext MQTT
 * credential, so it's built in the browser and never sent to the server. */
import type { SketchBoard } from "@/lib/firmware-sketch";

export const CONFIG_MAGIC = "IOCF";
export const CONFIG_BLOB_VERSION = 1;
export const CONFIG_HEADER_SIZE = 16;

/** One sensor or actuator wired to the board: which driver, on which GPIOs,
 * with which params, and which metric (or actuator) each channel feeds. */
export interface HardwareBinding {
  driver: string;
  pins: Record<string, number>;
  params?: Record<string, number | boolean | string>;
  /** Driver channel → metric key (inputs) or "value" → actuator key (outputs). */
  channels: Record<string, string>;
}

export interface FirmwareConfig {
  v: 1;
  /** The chip, which the firmware checks against its own build. */
  board: SketchBoard;
  /** The board model (firmware/boards.json). Informational: the firmware logs it. */
  model?: string;
  device: { tenant: string; device: string };
  mqtt: { host: string; port: number; tls: boolean; username: string; password: string };
  /** Phone provisioning; `salt`/`verifier` (base64) for Security 2. */
  prov?: { name: string; security: 1 | 2; salt?: string; verifier?: string };
  /** Bench test only: Wi-Fi typed in instead of provisioned from a phone. */
  wifi?: { ssid: string; password: string };
  i2c?: { sda: number; scl: number };
  /** The board model's reset button and status LED. Optional and additive:
   * firmware before 0.6.0 ignores it, and 0.6.0+ falls back to the chip's
   * defaults (firmware/src/board.h) when it's absent. */
  board_io?: { reset_pin: number; led: { type: "gpio" | "rgb" | "none"; pin: number; active_low: boolean } };
  metrics: { key: string; bool?: boolean; publish?: string; interval_s?: number; deadband?: number }[];
  actuators: { key: string; type: string }[];
  inputs: HardwareBinding[];
  outputs: HardwareBinding[];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, the zlib one), as firmware/src/crc32.h computes it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The bytes to write at the `cfg` partition's offset. Throws if the config
 * doesn't fit the partition. */
export function encodeConfigBlob(config: FirmwareConfig, partitionSize: number): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(config));
  if (CONFIG_HEADER_SIZE + json.length > partitionSize) {
    throw new Error(`The device config is ${json.length} bytes; the board has room for ${partitionSize - CONFIG_HEADER_SIZE}.`);
  }
  const blob = new Uint8Array(partitionSize).fill(0xff);
  const view = new DataView(blob.buffer);
  blob.set(new TextEncoder().encode(CONFIG_MAGIC), 0);
  view.setUint16(4, CONFIG_BLOB_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, json.length, true);
  view.setUint32(12, crc32(json), true);
  blob.set(json, CONFIG_HEADER_SIZE);
  return blob;
}
