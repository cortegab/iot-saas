import { describe, expect, it } from "vitest";
import { buildSketch, defaultPins, pinChoices, pinClashes, PIN_CHOICES, provisioningPayload, provName, type SketchInfo } from "./firmware-sketch";

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

  it("switches port with TLS", () => {
    expect(buildSketch(base)).toContain("const int MQTT_PORT = 8883;");
    expect(buildSketch({ ...base, tls: false })).toContain("const int MQTT_PORT = 1883;");
  });
});

describe("Wi-Fi: only the chosen mode is in the sketch", () => {
  it("typed Wi-Fi: plain WiFi.begin, no BLE, no provisioning, default partition", () => {
    const typed = buildSketch({ ...base, wifi: { ssid: 'My "Lab"', password: "pw" } });
    expect(typed).toContain('const char* WIFI_SSID = "My \\"Lab\\"";');
    expect(typed).toContain('const char* WIFI_PASSWORD = "pw";');
    expect(typed).not.toMatch(/WiFiProv|BLE|Huge APP|6e1f0001/);
  });

  it("phone, Security 1: WiFiProv with the MQTT password as the PoP, no SRP arrays", () => {
    const sketch = buildSketch({ ...base, provisioning: { security: 1 } });
    expect(sketch).toContain("#include <WiFiProv.h>");
    expect(sketch).toContain("NETWORK_PROV_SECURITY_1, MQTT_PASSWORD");
    expect(sketch).toContain('const char* PROV_NAME = "Bay 1";');
    expect(sketch).toContain("Huge APP");
    expect(sketch).not.toMatch(/SEC2_SALT|6e1f0001|BLEDevice/);
  });

  it("phone, Security 2: salt and verifier bytes, passed as the security params", () => {
    const sketch = buildSketch({
      ...base,
      provisioning: { security: 2, salt: Uint8Array.from([1, 2, 255]), verifier: Uint8Array.from([0xab, 0xcd]) },
    });
    expect(sketch).toContain("NETWORK_PROV_SECURITY_2, (const char*)&SEC2_PARAMS");
    expect(sketch).toContain("0x01, 0x02, 0xff");
    expect(sketch).toContain("0xab, 0xcd");
  });
});

describe("boards", () => {
  it("ESP32: pins common to the 30- and 38-pin DevKits, no strapping, UART, flash or input-only pins", () => {
    const choices = pinChoices("esp32");
    for (const bad of [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15, 34, 35, 36, 39]) expect(choices).not.toContain(bad);
    const pins = defaultPins(base.metrics, base.actuators, "esp32");
    expect(pins).toEqual({ "m:door": 4, "a:fan1": 23 });
  });

  it("ESP32: BTDM handler, reset button on GPIO 19 (on both headers)", () => {
    const sketch = buildSketch(base);
    expect(sketch).toContain("NETWORK_PROV_SCHEME_HANDLER_FREE_BTDM");
    expect(sketch).toContain("const int RESET_PIN = 19;");
    expect(pinChoices("esp32")).not.toContain(19);
    expect(sketch).toContain('Board: "ESP32 Dev Module"');
  });

  it("ESP32-C3: BLE-only handler, reset on BOOT (GPIO 9), low TX power, C3 pins, IDE settings", () => {
    const sketch = buildSketch({ ...base, board: "esp32c3" });
    expect(sketch).toContain("NETWORK_PROV_SCHEME_HANDLER_FREE_BLE");
    expect(sketch).toContain("const int RESET_PIN = 9;");
    expect(sketch).toContain("WIFI_POWER_8_5dBm");
    expect(sketch).toContain("USB CDC On Boot: Enabled");
    const pins = defaultPins(base.metrics, base.actuators, "esp32c3");
    expect(pinChoices("esp32c3")).toContain(pins["m:door"]);
    for (const p of Object.values(pins)) expect([2, 8, 9, 18, 19]).not.toContain(p);
  });
});

describe("provisioning name and QR payload", () => {
  it("makes the device name BLE-safe and at most 29 bytes", () => {
    const name = provName("Ñandú bay 1 — invernadero norte grande");
    expect(name).toMatch(/^[\x20-\x7e]+$/);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(29);
    expect(name.startsWith("Nandu bay 1")).toBe(true);
  });

  it("Security 1 payload: name, pop and an explicit security 1, no username", () => {
    expect(JSON.parse(provisioningPayload({ name: "Bay 1", username: "u", password: "p", security: 1 }))).toEqual({
      ver: "v1",
      name: "Bay 1",
      pop: "p",
      transport: "ble",
      network: "wifi",
      security: 1,
    });
  });

  it("Security 2 payload adds the username; the sketch's PROV_NAME matches the QR name", () => {
    const payload = JSON.parse(provisioningPayload({ name: provName("Bay 1"), username: "u", password: "p", security: 2 }));
    expect(payload).toEqual({ ver: "v1", name: "Bay 1", username: "u", pop: "p", transport: "ble", network: "wifi", security: 2 });
    expect(buildSketch({ ...base, provisioning: { security: 2 } })).toContain(`const char* PROV_NAME = "${payload.name}";`);
  });
});
