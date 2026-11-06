import { explainFailure, networksFrom, signalLabel } from "./wifi";
import { devicesForQr } from "./scanned";

describe("networksFrom", () => {
  it("keeps one row per name, the strongest, strongest first, no hidden ones", () => {
    expect(
      networksFrom([
        { ssid: "Shed", rssi: -80, auth: 3 },
        { ssid: "Office", rssi: -50, auth: 0 },
        { ssid: "Shed", rssi: -61, auth: 3 },
        { ssid: "", rssi: -40, auth: 3 },
      ]),
    ).toEqual([
      { ssid: "Office", rssi: -50, open: true },
      { ssid: "Shed", rssi: -61, open: false },
    ]);
  });

  it("names signal strength in words", () => {
    expect([-55, -70, -80, -90].map(signalLabel)).toEqual(["Strong", "Good", "Weak", "Very weak"]);
  });
});

describe("explainFailure", () => {
  it("gives the fix for each known failure", () => {
    expect(explainFailure("provision", new Error("AUTH_FAILED")).title).toBe("The Wi-Fi password is wrong");
    expect(explainFailure("provision", new Error("NETWORK_NOT_FOUND")).detail).toMatch(/2\.4 GHz/);
    expect(explainFailure("connect", new Error("Device not found.")).detail).toMatch(/reset button/);
    expect(explainFailure("connect", new Error("Failed to create session")).title).toBe("The board didn't accept this QR");
    expect(explainFailure("permission", new Error("x")).title).toMatch(/Bluetooth access/);
  });
});

describe("devicesForQr", () => {
  const d = (id: string, name: string) => ({ id, name }) as Parameters<typeof devicesForQr>[0][number];
  const devices = [d("a", "Bay 1"), d("b", "Bày 1"), d("c", "Pump")];

  it("matches the advertised name, accents dropped like the firmware's", () => {
    expect(devicesForQr(devices, { name: "Bay 1", pop: "p", username: null, security: 1 }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(devicesForQr(devices, { name: "Nope", pop: "p", username: null, security: 1 })).toEqual([]);
  });

  it("uses the Security 2 username (the device id) when it is there", () => {
    expect(devicesForQr(devices, { name: "Bay 1", pop: "p", username: "b", security: 2 }).map((x) => x.id)).toEqual(["b"]);
  });
});
