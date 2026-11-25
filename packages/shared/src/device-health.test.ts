import { describe, expect, it } from "vitest";
import { healthKey, healthLabel } from "./device-health";

const online = { status: "active", connection_state: "online" } as const;

describe("healthKey", () => {
  it("says nothing when the status already does", () => {
    expect(healthKey({ status: "active", connection_state: "offline" })).toBeNull();
    expect(healthKey({ status: "active", connection_state: "never_connected" })).toBeNull();
    expect(healthKey({ status: "disabled", connection_state: "online" })).toBeNull();
  });
  it("is healthy with nothing wrong, or nothing reported", () => {
    expect(healthKey(online)).toBe("healthy");
    expect(healthKey({ ...online, rssi: -63, battery_pct: 87, reset_reason: "power_on", faults: [] })).toBe("healthy");
  });
  it("puts the most pressing problem first", () => {
    const all = { ...online, rssi: -90, battery_pct: 5, reset_reason: "brownout", faults: ["dht22@4: no reply"] };
    expect(healthKey(all)).toBe("faults");
    expect(healthKey({ ...all, faults: [] })).toBe("restarted");
    expect(healthKey({ ...all, faults: [], reset_reason: "reset_pin" })).toBe("weak_wifi");
    expect(healthKey({ ...all, faults: [], reset_reason: null, rssi: -70 })).toBe("battery_low");
  });
  it("treats every watchdog and a crash as a fault restart, not a power-on", () => {
    for (const r of ["crash", "task_wdt", "interrupt_wdt", "other_wdt"]) expect(healthKey({ ...online, reset_reason: r })).toBe("restarted");
    expect(healthKey({ ...online, reset_reason: "software" })).toBe("healthy");
  });
});

describe("healthLabel", () => {
  it("counts several failing sensors", () => {
    expect(healthLabel("faults", { faults: ["a"] })).toBe("Sensor not answering");
    expect(healthLabel("faults", { faults: ["a", "b"] })).toBe("2 sensors not answering");
    expect(healthLabel("weak_wifi", { faults: [] })).toBe("Weak Wi-Fi");
  });
});
