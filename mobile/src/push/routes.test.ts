import { parseSettings, routeFor } from "./routes";

describe("push notification taps", () => {
  it("opens the device that went offline, in its workspace", () => {
    expect(routeFor({ kind: "device_offline", device_id: "d1", tenant_id: "t1" })).toEqual({ tenantId: "t1", href: "/devices/d1" });
  });

  it("opens Alerts for everything else, or for anything malformed", () => {
    expect(routeFor({ kind: "rule_fired", device_id: "d1", tenant_id: "t1" })).toEqual({ tenantId: "t1", href: "/alerts" });
    expect(routeFor({ kind: "device_offline" })).toEqual({ tenantId: null, href: "/alerts" });
    expect(routeFor(null)).toEqual({ tenantId: null, href: "/alerts" });
  });
});

describe("stored settings", () => {
  it("defaults to on, warnings and critical", () => {
    expect(parseSettings(null)).toEqual({ id: null, enabled: true, minSeverity: "warning" });
    expect(parseSettings("not json")).toEqual({ id: null, enabled: true, minSeverity: "warning" });
  });

  it("reads back what was saved", () => {
    expect(parseSettings('{"id":"p1","enabled":false,"minSeverity":"critical"}')).toEqual({ id: "p1", enabled: false, minSeverity: "critical" });
  });
});
