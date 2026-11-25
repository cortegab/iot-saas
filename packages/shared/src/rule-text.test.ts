import { describe, expect, it } from "vitest";
import { RULE_STATE, actionsText, conditionText, ruleStateKey, sharedActuators, triggerText } from "./rule-text";
import type { components } from "./api";

type RuleResponse = components["schemas"]["RuleResponse"];

const leaf = (metric: string, operator: string, value: number) =>
  ({ kind: "leaf", device_id: "d1", metric, operator, rhs: { source: "static", value }, hysteresis: 0 }) as never;

function rule(id: string, actions: Record<string, unknown>[], enabled = true): RuleResponse {
  return {
    id,
    name: id,
    enabled,
    trigger: { type: "metric" },
    condition: leaf("temperature", ">", 27),
    actions,
    clear_actions: [],
    devices: [{ device_id: "dev1", role: "target", device_name: "bay1" }],
  } as unknown as RuleResponse;
}

describe("rule text", () => {
  it("words conditions with symbols and nested groups", () => {
    const tree = { kind: "group", op: "AND", predicates: [leaf("t", ">", 27), { kind: "group", op: "OR", predicates: [leaf("h", "<", 40), leaf("d", "==", 1)] }] };
    expect(conditionText(tree as never)).toBe("t > 27 and (h < 40 or d = 1)");
  });

  it("words schedule triggers in the shared plain wording", () => {
    expect(triggerText({ trigger: { type: "schedule", cron: "0 22 * * 1-5" }, condition: null, devices: [] } as never)).toBe(
      "weekdays at 22:00",
    );
  });

  it("summarises actions", () => {
    expect(actionsText([{ type: "actuator_command", actuator: "fan1", value: true }])).toBe("Turn fan1 on");
    expect(actionsText([{ type: "email", to: [] }])).toBe("Email the alert recipients");
    expect(actionsText([])).toBe("Nothing");
  });

  it("flags actuators shared by two enabled rules only", () => {
    const fan = { type: "actuator_command", actuator: "fan1", value: true };
    const shared = sharedActuators([rule("a", [fan]), rule("b", [{ ...fan, value: false }]), rule("c", [fan], false)]);
    expect(shared.get("a")).toEqual(["fan1"]);
    expect(shared.get("b")).toEqual(["fan1"]);
    expect(shared.has("c")).toBe(false);
  });
});

describe("ruleStateKey", () => {
  const r = (o: { enabled?: boolean; latched?: boolean; evaluatable?: boolean }) => ({
    enabled: o.enabled ?? true,
    latched: o.latched ?? false,
    health: { evaluatable: o.evaluatable ?? true },
  });
  it("gives each rule one state: can't evaluate replaces armed", () => {
    expect(ruleStateKey(r({}))).toBe("armed");
    expect(ruleStateKey(r({ evaluatable: false }))).toBe("stale");
    expect(RULE_STATE.stale.label).toBe("Can't evaluate");
  });
  it("lets disabled and latched win, since they ask someone to act", () => {
    expect(ruleStateKey(r({ enabled: false, evaluatable: false }))).toBe("disabled");
    expect(ruleStateKey(r({ latched: true, evaluatable: false }))).toBe("latched");
  });
  it("reads armed when health isn't known", () => {
    expect(ruleStateKey({ enabled: true, latched: false })).toBe("armed");
  });
});
