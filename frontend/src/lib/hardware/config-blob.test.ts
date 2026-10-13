import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_HEADER_SIZE, crc32, encodeConfigBlob, type FirmwareConfig } from "./config-blob";

// The vector the firmware's reader is tested against too (firmware/test/).
const vector = JSON.parse(readFileSync(new URL("../../../../firmware/test/config-vector.json", import.meta.url), "utf8")) as {
  json: string;
  crc32: string;
  header_hex: string;
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("crc32", () => {
  it("is the zlib CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode(vector.json))).toBe(Number(vector.crc32));
  });
});

describe("encodeConfigBlob", () => {
  const config = JSON.parse(vector.json) as FirmwareConfig;

  it("writes the header the firmware expects, then the JSON, then 0xFF", () => {
    const blob = encodeConfigBlob(config, 4096);
    expect(blob.length).toBe(4096);
    expect(hex(blob.slice(0, CONFIG_HEADER_SIZE))).toBe(vector.header_hex);
    const end = CONFIG_HEADER_SIZE + vector.json.length;
    expect(new TextDecoder().decode(blob.slice(CONFIG_HEADER_SIZE, end))).toBe(vector.json);
    expect(blob.slice(end).every((b) => b === 0xff)).toBe(true);
  });

  it("refuses a config that doesn't fit the partition", () => {
    expect(() => encodeConfigBlob(config, CONFIG_HEADER_SIZE + 10)).toThrow(/room for 10/);
  });
});
