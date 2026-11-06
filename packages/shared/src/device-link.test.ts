import { describe, expect, it } from "vitest";
import { deviceIdFromLink, deviceLink } from "./device-link";

const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("device label link", () => {
  it("builds the link from the web origin", () => {
    expect(deviceLink("https://iodriven.tech", ID)).toBe(`https://iodriven.tech/d/${ID}`);
    expect(deviceLink("http://localhost:3000/", ID)).toBe(`http://localhost:3000/d/${ID}`);
  });

  it("reads the id back from any host", () => {
    expect(deviceIdFromLink(`https://iodriven.tech/d/${ID}`)).toBe(ID);
    expect(deviceIdFromLink(` http://localhost:3000/d/${ID.toUpperCase()}/?x=1 `)).toBe(ID);
  });

  it("rejects anything else", () => {
    expect(deviceIdFromLink(`https://iodriven.tech/devices/${ID}`)).toBeNull();
    expect(deviceIdFromLink("https://iodriven.tech/d/not-a-uuid")).toBeNull();
    expect(deviceIdFromLink('{"ver":"v1","name":"Pump"}')).toBeNull();
  });
});
