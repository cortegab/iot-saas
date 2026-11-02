import { describe, expect, it } from "vitest";
import { landingPath } from "./landing";

const base = { target: "dashboard" as const, dashboard_id: null, dashboard_ids: ["a", "b"], setup_complete: true, role: "viewer" };

describe("landingPath", () => {
  it("sends setup and welcome to their pages", () => {
    expect(landingPath({ ...base, target: "setup" }, null)).toBe("/start");
    expect(landingPath({ ...base, target: "welcome", dashboard_ids: [] }, null)).toBe("/welcome");
  });

  it("prefers the default, then the last opened, then the newest", () => {
    expect(landingPath({ ...base, dashboard_id: "b" }, "a")).toBe("/dashboards/b");
    expect(landingPath(base, "b")).toBe("/dashboards/b");
    expect(landingPath(base, null)).toBe("/dashboards/a");
  });

  it("ignores a last-opened dashboard that's gone", () => {
    expect(landingPath(base, "deleted")).toBe("/dashboards/a");
  });

  it("falls back to Devices", () => {
    expect(landingPath({ ...base, target: "devices", dashboard_ids: [] }, null)).toBe("/devices");
  });
});
