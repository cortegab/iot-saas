import { describe, expect, it } from "vitest";
import { guardsHardware, resetLatchReadings, resetLatchVerdict } from "./rule-safety";

const base = { actions: [], clear_actions: [], execution_policy: { strategy: "edge" } } as never;

describe("guardsHardware", () => {
  it("is true for an actuator action, an actuator clear, or a latch", () => {
    expect(guardsHardware({ ...(base as object), actions: [{ type: "actuator_command" }] } as never)).toBe(true);
    expect(guardsHardware({ ...(base as object), clear_actions: [{ type: "actuator_command" }] } as never)).toBe(true);
    expect(guardsHardware({ ...(base as object), execution_policy: { strategy: "latch" } } as never)).toBe(true);
  });
  it("is false for a notification-only rule", () => {
    expect(guardsHardware({ ...(base as object), actions: [{ type: "notification" }] } as never)).toBe(false);
  });
});

describe("resetLatchVerdict", () => {
  it("is cautious without a dry run", () => {
    expect(resetLatchVerdict(null)).toMatch(/couldn't check/);
  });
  it("says it fires again when the condition still holds", () => {
    expect(resetLatchVerdict({ would_fire: true, unavailable_signals: [] } as never)).toMatch(/fires again/);
  });
  it("says missing readings block it", () => {
    expect(resetLatchVerdict({ would_fire: false, unavailable_signals: ["x"] } as never)).toMatch(/missing or stale/);
  });
});

describe("resetLatchReadings", () => {
  it("names the reading, the device, the value and its age", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const lines = resetLatchReadings(
      {
        health: {
          signals: [
            { metric: "level", device_name: "Tank 1", last_value: 12.5, state: "fresh", last_seen_at: "2026-11-19T11:58:00Z" },
            { metric: "flow", device_name: null, last_value: null, state: "missing", last_seen_at: null },
          ],
        },
      } as never,
      now,
    );
    expect(lines[0]).toBe("level on Tank 1: 12.5 · 2 min ago");
    expect(lines[1]).toBe("flow on a device: — · missing");
  });
});
