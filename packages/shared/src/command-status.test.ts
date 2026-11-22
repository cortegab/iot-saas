import { describe, expect, it } from "vitest";
import { commandStatus, lastConfirmedValue, manualSender, msUntilCommandDeadline } from "./command-status";
import { getDeviceActuators, rulesDrivingActuator } from "./device-actuators";
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

describe("stored expiry and last confirmed", () => {
  const base = { id: "c", device_id: "d", rule_id: null, actuator: "fan", value: true, issued_at: "2026-11-19T12:00:00Z", ttl_seconds: 30, published_at: "2026-11-19T12:00:00Z", acked_at: null, latency_ms: 1 };
  it("treats a command the server expired as no response, even before the local deadline", () => {
    const c = { ...base, expired_at: "2026-11-19T12:00:31Z" } as never;
    expect(commandStatus(c, Date.parse("2026-11-19T12:00:05Z"))).toBe("no-response");
  });
  it("lets a late ack win over a stored expiry", () => {
    const c = { ...base, expired_at: "2026-11-19T12:00:31Z", acked_at: "2026-11-19T12:00:40Z" } as never;
    expect(commandStatus(c)).toBe("confirmed");
  });
  it("finds the last confirmed value", () => {
    const list = [
      { ...base, id: "3", value: false },
      { ...base, id: "2", value: true, acked_at: "2026-11-19T11:00:00Z" },
    ] as never;
    expect(lastConfirmedValue(list, "fan")).toBe(true);
    expect(lastConfirmedValue(list, "pump")).toBeUndefined();
  });
  it("names who sent a manual command", () => {
    const members = [{ user_id: "u2", name: "Ana", email: "ana@x.io" }];
    expect(manualSender({ requested_by: "u1" }, members, "u1")).toBe("by you");
    expect(manualSender({ requested_by: "u2" }, members, "u1")).toBe("by Ana");
    expect(manualSender({ requested_by: null }, members, "u1")).toBe("manually");
  });
});

describe("rulesDrivingActuator", () => {
  it("names enabled rules that switch this device's actuator", () => {
    const rules = [
      { name: "Too hot", enabled: true, actions: [{ type: "actuator_command", actuator: "fan", device_id: "d" }], clear_actions: [] },
      { name: "Off at night", enabled: true, actions: [], clear_actions: [{ type: "actuator_command", actuator: "fan", device_id: null }] },
      { name: "Paused", enabled: false, actions: [{ type: "actuator_command", actuator: "fan", device_id: "d" }], clear_actions: [] },
      { name: "Other box", enabled: true, actions: [{ type: "actuator_command", actuator: "fan", device_id: "e" }], clear_actions: [] },
    ] as never;
    expect(rulesDrivingActuator(rules, "d", "fan")).toEqual(["Too hot", "Off at night"]);
  });
});
