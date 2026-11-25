import type { components } from "@iodriven/shared/api";
import { matchesFilter, ruleCounts, ruleSentence } from "./rules";

type RuleResponse = components["schemas"]["RuleResponse"];
const rule = (over: Partial<RuleResponse>) =>
  ({
    enabled: true,
    latched: false,
    health: { evaluatable: true, signals: [] },
    trigger: { type: "metric" },
    condition: { kind: "leaf", metric: "temperature", operator: ">", rhs: { source: "static", value: 27 } },
    actions: [{ type: "actuator_command", actuator: "fan1", value: true }],
    devices: [],
    ...over,
  }) as unknown as RuleResponse;

describe("rules list", () => {
  it("counts states like the web's filter", () => {
    const rules = [rule({}), rule({ latched: true }), rule({ enabled: false }), rule({ health: { evaluatable: false, signals: [] } })];
    // One state per rule: the rule that can't evaluate is no longer counted as armed too.
    expect(ruleCounts(rules)).toEqual({ all: 4, armed: 1, latched: 1, disabled: 1, stale: 1 });
    expect(rules.filter((r) => matchesFilter(r, "stale"))).toHaveLength(1);
    expect(rules.filter((r) => matchesFilter(r, "latched"))).toHaveLength(1);
  });

  it("says what a rule does, and never throws", () => {
    expect(ruleSentence(rule({}))).toBe("When temperature > 27 → turn fan1 on");
    expect(ruleSentence(rule({ condition: { nonsense: true } as never, actions: null as never }))).toBe("Open on the web to see what it does");
  });
});
