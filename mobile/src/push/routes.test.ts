import { parseSettings, pushedAlert, routeFor } from "./routes";

describe("push notification taps", () => {
  it("opens the device that went offline, in its workspace", () => {
    expect(routeFor({ kind: "device_offline", device_id: "d1", tenant_id: "t1" })).toEqual({ tenantId: "t1", href: "/devices/d1" });
    expect(routeFor({ kind: "device_health", device_id: "d1", tenant_id: "t1" })).toEqual({ tenantId: "t1", href: "/devices/d1" });
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

describe("pushedAlert", () => {
  it("finds the alert among the same device's or rule's unread ones", () => {
    expect(pushedAlert({ notification_id: "n1", device_id: "d1", rule_id: "r1", kind: "rule_fired" })).toEqual({
      notificationId: "n1",
      groupsQuery: "/notifications/groups?unread=true&limit=100&device_id=d1&rule_id=r1",
    });
    expect(pushedAlert({ notification_id: "n2", device_id: "d1" })?.groupsQuery).toBe("/notifications/groups?unread=true&limit=100&device_id=d1");
  });

  it("is null without a notification id", () => {
    expect(pushedAlert({ device_id: "d1" })).toBeNull();
    expect(pushedAlert(null)).toBeNull();
  });
});
