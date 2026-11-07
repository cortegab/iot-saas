import { describe, expect, it } from "vitest";
import { commandStatus, msUntilCommandDeadline } from "./command-status";
import { getDeviceActuators } from "./device-actuators";
import type { components } from "./api";

type CommandResponse = components["schemas"]["CommandResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const t0 = Date.parse("2026-11-05T12:00:00Z");
const cmd = (over: Partial<CommandResponse>) => ({ issued_at: new Date(t0).toISOString(), ttl_seconds: 30, acked_at: null, ...over }) as CommandResponse;

describe("commandStatus", () => {
  it("waits until the TTL, then says No response; an ack wins at any time", () => {
    expect(commandStatus(cmd({}), t0 + 10_000)).toBe("pending");
    expect(msUntilCommandDeadline(cmd({}), t0 + 10_000)).toBe(20_000);
    expect(commandStatus(cmd({}), t0 + 31_000)).toBe("no-response");
    expect(msUntilCommandDeadline(cmd({}), t0 + 31_000)).toBeNull();
    expect(commandStatus(cmd({ acked_at: new Date(t0 + 60_000).toISOString() }), t0 + 90_000)).toBe("confirmed");
  });
});

describe("getDeviceActuators", () => {
  const template = { actuators: [{ key: "fan1", name: "Fan" }] } as unknown as CatalogEntryResponse;
  const rule = (actions: unknown[]) => ({ actions }) as unknown as RuleResponse;

  it("lists the template's actuators, plus ones a rule commands on this device", () => {
    const rules = [
      rule([{ type: "actuator_command", actuator: "pump", device_id: "d1" }]),
      rule([{ type: "actuator_command", actuator: "valve", device_id: "other" }]),
      rule([{ type: "actuator_command", actuator: "fan1" }]),
    ];
    expect(getDeviceActuators(template, rules, "d1")).toEqual([
      { id: "fan1", label: "Fan" },
      { id: "pump", label: "pump" },
    ]);
  });
});
