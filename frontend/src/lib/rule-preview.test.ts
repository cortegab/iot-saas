import { describe, expect, it } from "vitest";
import { recipesFor } from "./rule-recipes";
import { ruleChecks, sectionIssues, wouldSend } from "./rule-preview";

const device = {
  id: "dev-1",
  name: "bay1",
  metrics: [{ key: "temperature", name: "Temperature", data_type: "float", unit: "°C", min: 0, max: 40 }],
  actuators: [{ key: "fan1", name: "Fan", value_type: "bool" }],
};
const hot = () => recipesFor(device).find((r) => r.id === "too-hot")!.draft;

describe("ruleChecks", () => {
  it("passes a safe hardware rule", () => {
    expect(ruleChecks(hot()).every((c) => c.ok)).toBe(true);
    expect(ruleChecks(hot()).map((c) => c.id)).toEqual(["conditions", "actions", "hold", "interval", "hysteresis"]);
  });

  it("flags short holds, short intervals and zero hysteresis", () => {
    const d = hot();
    d.forDuration = 0;
    d.cooldown = 5;
    if (d.condition?.kind === "contact") d.condition.hysteresis = 0;
    const failed = ruleChecks(d).filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(["hold", "interval", "hysteresis"]);
    // Safety checks are warnings (they never block a save, as in the rail);
    // only incomplete conditions or actions are blocking.
    expect(ruleChecks(d).filter((c) => c.blocking).map((c) => c.id)).toEqual(["conditions", "actions"]);
  });

  it("reports incomplete conditions and actions in the editor's words", () => {
    const d = hot();
    if (d.condition?.kind === "contact") d.condition.metric = "";
    d.actions = [];
    const byId = Object.fromEntries(ruleChecks(d).map((c) => [c.id, c]));
    expect(byId.conditions.detail).toBe("Every condition needs a device and a metric.");
    expect(byId.actions.detail).toBe("Add at least one action.");
  });
});

describe("wouldSend", () => {
  it("shows the command and the revert on the device's topic", () => {
    const sends = wouldSend(hot(), "acme", () => "bay1-climate");
    expect(sends).toEqual([
      { kind: "command", target: "acme/bay1-climate/cmd/fan1", payload: '{"value":true,"ttl":30}' },
      { kind: "clear", target: "acme/bay1-climate/cmd/fan1", payload: '{"value":false,"ttl":30}' },
    ]);
  });
});

describe("sectionIssues", () => {
  it("a safe hardware rule has none", () => {
    expect(sectionIssues(hot())).toEqual([]);
  });

  it("places each problem in the section that fixes it; only completeness blocks a save", () => {
    const d = hot();
    d.forDuration = 0;
    d.cooldown = 5;
    if (d.condition?.kind === "contact") d.condition.hysteresis = 0;
    d.actions = [];
    d.name = "x".repeat(201);
    const issues = sectionIssues(d);
    expect(issues.map((i) => [i.section, i.blocking])).toEqual([
      ["then", true],
      ["behaviour", false],
      ["behaviour", false],
      ["name", true],
    ]);
  });

  it("warns about missing hysteresis on a rule that switches hardware, under If", () => {
    const d = hot();
    if (d.condition?.kind === "contact") d.condition.hysteresis = 0;
    expect(sectionIssues(d)).toEqual([{ section: "if", blocking: false, message: expect.stringContaining("hysteresis") }]);
  });

  it("blocks a reading rule with no condition", () => {
    const d = hot();
    d.condition = null;
    expect(sectionIssues(d).filter((i) => i.blocking).map((i) => i.section)).toEqual(["if"]);
  });
});
