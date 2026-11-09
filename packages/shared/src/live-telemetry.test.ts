import { describe, expect, it } from "vitest";
import type { components } from "./api";
import { applyDeviceHealth, frameDiagnostics } from "./live-telemetry";

type DeviceResponse = components["schemas"]["DeviceResponse"];

const device = {
  id: "d1",
  connection_state: "online",
  boot_count: 3,
  reset_reason: "power_on",
  faults: ["dht22@GPIO4: not answering"],
} as unknown as DeviceResponse;

const health = { rssi: -60, battery_pct: null, uptime_s: 10, fw_version: "0.14.0" };

describe("device_health diagnostics", () => {
  it("reads a frame's diagnostics only when it carries them", () => {
    expect(frameDiagnostics({ online: true } as never)).toBeUndefined();
    expect(frameDiagnostics({ boot_count: 4, reset_reason: "crash", faults: [] })).toEqual({
      reset_reason: "crash",
      boot_count: 4,
      heap_free: null,
      heap_min: null,
      wifi_reconnects: null,
      faults: [],
    });
  });

  it("applies an online report's diagnostics", () => {
    const next = applyDeviceHealth({ online: true, ...health, diagnostics: frameDiagnostics({ boot_count: 4, reset_reason: "crash", faults: [] }) })(device)!;
    expect([next.boot_count, next.reset_reason, next.faults]).toEqual([4, "crash", []]);
  });

  it("keeps the last known diagnostics through a Last-Will", () => {
    const next = applyDeviceHealth({ online: false, rssi: null, battery_pct: null, uptime_s: null, fw_version: null })(device)!;
    expect(next.connection_state).toBe("offline");
    expect([next.boot_count, next.faults]).toEqual([3, ["dht22@GPIO4: not answering"]]);
  });
});
