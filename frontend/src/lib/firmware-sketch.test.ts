import { describe, expect, it } from "vitest";
import { buildSketch, defaultPins, pinClashes, PIN_CHOICES, type SketchInfo } from "./firmware-sketch";

const base: SketchInfo = {
  tenantSlug: "acme",
  deviceSlug: "bay1",
  deviceName: "Bay 1",
  host: "mqtt.example.com",
  tls: true,
  metrics: [
    { key: "temperature", name: "Temperature", data_type: "float" },
    { key: "door", name: "Door", data_type: "bool" },
  ],
  actuators: [{ key: "fan1", name: "Fan", value_type: "bool" }],
  credential: { username: "u", password: "p" },
};

describe("defaultPins / pinClashes", () => {
  it("hands out distinct pins for bool inputs and outputs only", () => {
    const pins = defaultPins(base.metrics, base.actuators);
    expect(Object.keys(pins).sort()).toEqual(["a:fan1", "m:door"]);
    expect(pinClashes(pins)).toEqual({});
    expect(PIN_CHOICES).toContain(pins["m:door"]);
  });

  it("reports both sides of a shared pin", () => {
    const clashes = pinClashes({ "m:door": 4, "a:fan1": 4, "a:pump": 23 });
    expect(clashes["m:door"]).toBe("GPIO 4 is also used by fan1.");
    expect(clashes["a:fan1"]).toBe("GPIO 4 is also used by door.");
    expect(clashes["a:pump"]).toBeUndefined();
  });
});

describe("buildSketch options", () => {
  it("uses pin overrides", () => {
    const sketch = buildSketch({ ...base, pins: { "a:fan1": 26 } });
    expect(sketch).toContain("const int FAN1_PIN = 26;");
  });

  it("leaves Wi-Fi empty for BLE provisioning, fills it when typed in", () => {
    expect(buildSketch(base)).toContain('const char* DEV_WIFI_SSID = "";');
    const typed = buildSketch({ ...base, wifi: { ssid: 'My "Lab"', password: "pw" } });
    expect(typed).toContain('const char* DEV_WIFI_SSID = "My \\"Lab\\"";');
    expect(typed).toContain('const char* DEV_WIFI_PASSWORD = "pw";');
  });

  it("switches port with TLS", () => {
    expect(buildSketch(base)).toContain("const int MQTT_PORT = 8883;");
    expect(buildSketch({ ...base, tls: false })).toContain("const int MQTT_PORT = 1883;");
  });
});
