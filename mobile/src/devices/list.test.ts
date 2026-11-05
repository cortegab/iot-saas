import type { components } from "@iodriven/shared/api";
import { matchesQuery, statusCounts, visibleDevices } from "./list";

type DeviceResponse = components["schemas"]["DeviceResponse"];
const device = (name: string, connection_state: string | null, status = "active") =>
  ({ id: name, name, status, connection_state }) as unknown as DeviceResponse;

const devices = [device("pump house", "offline"), device("bay 2", "online"), device("bay 1", "online"), device("spare", null), device("old", "online", "disabled")];

describe("matchesQuery", () => {
  it("matches every word anywhere, ignoring case", () => {
    expect(matchesQuery("BAY 1", "bay 1")).toBe(true);
    expect(matchesQuery("house pump", "pump house")).toBe(true);
    expect(matchesQuery("bay 3", "bay 1")).toBe(false);
    expect(matchesQuery("  ", "anything")).toBe(true);
  });
});

describe("visibleDevices", () => {
  it("puts online first, then by name", () => {
    expect(visibleDevices(devices, "all", "").map((d) => d.name)).toEqual(["bay 1", "bay 2", "pump house", "spare", "old"]);
  });
  it("filters by status and search together", () => {
    expect(visibleDevices(devices, "online", "2").map((d) => d.name)).toEqual(["bay 2"]);
    expect(visibleDevices(devices, "disabled", "").map((d) => d.name)).toEqual(["old"]);
  });
});

describe("statusCounts", () => {
  it("counts a disabled device as disabled whatever its connection", () => {
    expect(statusCounts(devices)).toEqual({ online: 2, offline: 1, never: 1, disabled: 1 });
  });
});
