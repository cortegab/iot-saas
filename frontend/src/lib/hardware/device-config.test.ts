import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_HEADER_SIZE, encodeConfigBlob } from "./config-blob";
import { brokerHostProblem, buildFirmwareConfig, type DeviceConfigInput } from "./device-config";
import type { BoardModel } from "./driver-catalog";
import { flashFiles, type FirmwareManifest } from "./flasher";

const MODELS = (JSON.parse(readFileSync(new URL("../../../../firmware/boards.json", import.meta.url), "utf8")) as { models: BoardModel[] }).models;
const devkit30 = MODELS.find((m) => m.id === "esp32-devkit-30")!;

const base: DeviceConfigInput = {
  tenantSlug: "io-driven",
  device: { slug: "test-device", name: "Test-Device" },
  metrics: [
    { name: "Door", key: "door", data_type: "bool", publish: "on_change", publish_deadband: null, publish_interval_seconds: null },
    { name: "Water level", data_type: "float", publish: "periodic", publish_interval_seconds: 10 },
  ],
  actuators: [{ name: "Fan", key: "fan1", value_type: "bool" }],
  wiring: {
    board: "esp32-devkit-30",
    i2c: null,
    inputs: [{ driver: "digital_in", pins: { pin: 4 }, params: { pull: "down" }, channels: { value: "door" } }],
    outputs: [{ driver: "relay", pins: { pin: 23 }, params: { active_low: true }, channels: { value: "fan1" } }],
  },
  model: devkit30,
  host: "192.168.1.82",
  tls: false,
  credential: { username: "b9691bcb-ffdb-47bf-ae27-992f68ddb7eb", password: "secret" },
  provisioning: { security: 1 },
};

describe("buildFirmwareConfig", () => {
  it("builds the config the firmware reads", () => {
    expect(buildFirmwareConfig(base)).toEqual({
      v: 1,
      board: "esp32",
      model: "esp32-devkit-30",
      device: { tenant: "io-driven", device: "test-device" },
      mqtt: { host: "192.168.1.82", port: 1883, tls: false, username: "b9691bcb-ffdb-47bf-ae27-992f68ddb7eb", password: "secret" },
      prov: { name: "Test-Device", security: 1 },
      metrics: [
        { key: "door", bool: true, publish: "on_change" },
        { key: "water-level", publish: "periodic", interval_s: 10 },
      ],
      actuators: [{ key: "fan1", type: "bool" }],
      inputs: [{ driver: "digital_in", pins: { pin: 4 }, params: { pull: "down" }, channels: { value: "door" } }],
      outputs: [{ driver: "relay", pins: { pin: 23 }, params: { active_low: true }, channels: { value: "fan1" } }],
    });
  });

  it("uses the TLS port with TLS", () => {
    expect(buildFirmwareConfig({ ...base, tls: true }).mqtt).toMatchObject({ port: 8883, tls: true });
  });

  it("carries the Security 2 salt and verifier as base64", () => {
    const cfg = buildFirmwareConfig({
      ...base,
      provisioning: { security: 2, salt: new Uint8Array([1, 2, 3]), verifier: new Uint8Array([255, 0]) },
    });
    expect(cfg.prov).toEqual({ name: "Test-Device", security: 2, salt: "AQID", verifier: "/wA=" });
  });

  it("includes typed-in Wi-Fi only when given", () => {
    expect(buildFirmwareConfig(base).wifi).toBeUndefined();
    expect(buildFirmwareConfig({ ...base, wifi: { ssid: "home", password: "pw" } }).wifi).toEqual({ ssid: "home", password: "pw" });
  });

  it("takes the board's chip and id from the model", () => {
    const c3 = MODELS.find((m) => m.id === "esp32c3-supermini")!;
    expect(buildFirmwareConfig({ ...base, model: c3 })).toMatchObject({ board: "esp32c3", model: "esp32c3-supermini" });
  });

  it("fits the board's config area", () => {
    const blob = encodeConfigBlob(buildFirmwareConfig(base), 32768);
    expect(new TextDecoder().decode(blob.slice(0, 4))).toBe("IOCF");
    expect(new DataView(blob.buffer).getUint32(8, true)).toBeGreaterThan(CONFIG_HEADER_SIZE);
  });
});

describe("brokerHostProblem", () => {
  it("refuses an address the board can't reach", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", ""]) expect(brokerHostProblem(h)).not.toBeNull();
  });
  it("accepts a LAN address or a hostname", () => {
    for (const h of ["192.168.1.82", "iodriven.tech"]) expect(brokerHostProblem(h)).toBeNull();
  });
});

describe("flashFiles", () => {
  const target: FirmwareManifest["boards"]["esp32"] = {
    chip: "ESP32",
    parts: [],
    app: { offset: 0x10000, size: 0x1e0000, used: 1 },
    cfg: { offset: 0x3d0000, size: 0x8000 },
    nvs: { offset: 0x9000, size: 0x5000 },
  };
  const parts = [{ name: "esp32/firmware.bin", data: new Uint8Array(4), address: 0x10000 }];
  const configBlob = new Uint8Array(16);

  it("a full install with eraseWifi blanks the NVS, then writes the config last", () => {
    const { files, notes } = flashFiles(target, { mode: "full", parts, configBlob, eraseWifi: true });
    expect(files.map((f) => f.address)).toEqual([0x10000, 0x9000, 0x3d0000]);
    expect(files[1].data.length).toBe(0x5000);
    expect(files[1].data.every((b) => b === 0xff)).toBe(true);
    expect(notes).toEqual([]);
  });

  it("a config-only update writes just the config and keeps the Wi-Fi", () => {
    const { files } = flashFiles(target, { mode: "config", parts, configBlob, eraseWifi: true });
    expect(files.map((f) => f.address)).toEqual([0x3d0000]);
  });

  it("keeps the Wi-Fi, and says so, when the release doesn't say where it is", () => {
    const { files, notes } = flashFiles({ ...target, nvs: undefined }, { mode: "full", parts, configBlob, eraseWifi: true });
    expect(files.map((f) => f.address)).toEqual([0x10000, 0x3d0000]);
    expect(notes[0]).toMatch(/kept/);
  });
});
