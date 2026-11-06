import { describe, expect, it } from "vitest";
import { parseProvisioningQr, provisioningPayload, provName } from "./provisioning-qr";

describe("parseProvisioningQr", () => {
  it("reads back what the web prints, Security 1 and 2", () => {
    expect(parseProvisioningQr(provisioningPayload({ name: provName("Bay 1"), username: "u", password: "secret", security: 1 }))).toEqual({
      name: "Bay 1",
      pop: "secret",
      username: null,
      security: 1,
    });
    expect(parseProvisioningQr(provisioningPayload({ name: "Bay 1", username: "dev-id", password: "secret", security: 2 }))).toEqual({
      name: "Bay 1",
      pop: "secret",
      username: "dev-id",
      security: 2,
    });
  });

  it("defaults to Security 2, as Espressif's apps do", () => {
    expect(parseProvisioningQr('{"ver":"v1","name":"X","pop":"p","transport":"ble"}')).toBeNull(); // 2 needs a username
    expect(parseProvisioningQr('{"ver":"v1","name":"X","pop":"p","username":"u"}')?.security).toBe(2);
  });

  it("rejects other QR codes", () => {
    expect(parseProvisioningQr("https://iodriven.tech/d/abc")).toBeNull();
    expect(parseProvisioningQr('{"name":"X","pop":"p","transport":"softap","security":1}')).toBeNull();
    expect(parseProvisioningQr('{"name":"X","security":1}')).toBeNull();
    expect(parseProvisioningQr("[1,2]")).toBeNull();
  });
});
