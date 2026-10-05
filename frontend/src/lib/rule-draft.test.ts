import { describe, expect, it } from "vitest";
import {
  conditionFromNode,
  contacts,
  draftFromRule,
  draftToRequest,
  emptyAction,
  emptyContact,
  emptyDraft,
  flappingRisk,
  insertBeside,
  removeNode,
  setGroupOp,
  validateDraft,
  type ActuatorActionDraft,
  type ContactDraft,
  type DraftNode,
  type RuleDraft,
} from "@/lib/rule-draft";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

const DEV_A = "aaaaaaaa-0000-0000-0000-000000000001";
const DEV_B = "bbbbbbbb-0000-0000-0000-000000000002";

function contact(metric: string, deviceId = DEV_A): ContactDraft {
  return { ...emptyContact(deviceId), metric, value: 30 };
}

/** Compact shape of a tree for assertions: "a", ["AND", ...], ["OR", ...]. */
function shape(node: DraftNode | null): unknown {
  if (node === null) return null;
  if (node.kind === "contact") return node.metric;
  return [node.op, ...node.children.map(shape)];
}

function rule(overrides: Partial<RuleResponse>): RuleResponse {
  return {
    id: "r1",
    name: "Rule",
    description: null,
    type: "threshold",
    trigger: { type: "metric" },
    condition: {
      kind: "leaf",
      device_id: DEV_A,
      metric: "temperature",
      operator: ">",
      rhs: { source: "static", value: 30 },
      hysteresis: 2,
    },
    execution_policy: {
      strategy: "edge",
      for_duration: 10,
      cooldown: 60,
      reset_condition: null,
      clear_for_duration: 0,
    },
    actions: [{ type: "actuator_command", device_id: DEV_B, actuator: "fan1", value: true }],
    clear_actions: [],
    devices: [],
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    health: { evaluatable: true, signals: [] },
    latched: false,
    action: {},
    for_duration: 10,
    cooldown: 60,
    ...overrides,
  } as RuleResponse;
}

describe("tree operations", () => {
  it("builds the request's segment 3: A AND (B OR C) AND D", () => {
    const a = contact("a");
    const b = contact("b");
    const c = contact("c");
    const d = contact("d");
    let tree: DraftNode | null = a;
    tree = insertBeside(tree, a.id, b, "AND");
    tree = insertBeside(tree, b.id, c, "OR");
    expect(shape(tree)).toEqual(["AND", "a", ["OR", "b", "c"]]);
    // D goes in series after the whole parallel block, not after C.
    const orBlock = tree!.kind === "group" ? tree!.children[1] : null;
    tree = insertBeside(tree, orBlock!.id, d, "AND");
    expect(shape(tree)).toEqual(["AND", "a", ["OR", "b", "c"], "d"]);
  });

  it("joins an existing series instead of nesting series in series", () => {
    const a = contact("a");
    const b = contact("b");
    const c = contact("c");
    let tree: DraftNode | null = insertBeside(a, a.id, b, "AND");
    tree = insertBeside(tree, a.id, c, "AND");
    expect(shape(tree)).toEqual(["AND", "a", "c", "b"]);
  });

  it("inserts into an empty tree", () => {
    const a = contact("a");
    expect(insertBeside(null, "x", a, "AND")).toBe(a);
  });

  it("collapses a group left with one child after a removal", () => {
    const a = contact("a");
    const b = contact("b");
    const c = contact("c");
    let tree: DraftNode | null = insertBeside(a, a.id, b, "AND");
    tree = insertBeside(tree, b.id, c, "OR");
    tree = removeNode(tree, c.id);
    expect(shape(tree)).toEqual(["AND", "a", "b"]);
    tree = removeNode(tree, b.id);
    expect(tree).toEqual(a);
    expect(removeNode(tree, a.id)).toBeNull();
  });

  it("merges a group into its parent when switched to the same operator", () => {
    const a = contact("a");
    const b = contact("b");
    const c = contact("c");
    let tree: DraftNode | null = insertBeside(a, a.id, b, "AND");
    tree = insertBeside(tree, b.id, c, "OR");
    const or = tree!.kind === "group" ? tree!.children[1] : null;
    tree = setGroupOp(tree, or!.id, "AND");
    expect(shape(tree)).toEqual(["AND", "a", "b", "c"]);
  });

  it("keeps ids stable across edits", () => {
    const a = contact("a");
    const b = contact("b");
    const tree = insertBeside(a, a.id, b, "OR");
    expect(contacts(tree).map((c) => c.id)).toEqual([a.id, b.id]);
  });
});

describe("API round trip", () => {
  it("round-trips a nested multi-device condition unchanged", () => {
    const condition = {
      kind: "group",
      op: "AND",
      predicates: [
        {
          kind: "leaf",
          device_id: DEV_A,
          metric: "a",
          operator: ">",
          rhs: { source: "static", value: 1 },
          hysteresis: 0.5,
        },
        {
          kind: "group",
          op: "OR",
          predicates: [
            {
              kind: "leaf",
              device_id: DEV_B,
              metric: "b",
              operator: "between",
              rhs: { source: "range", low: 1, high: 2 },
              hysteresis: 0,
            },
            {
              kind: "leaf",
              device_id: DEV_B,
              metric: "c",
              operator: "changed",
              rhs: null,
              hysteresis: 0,
            },
          ],
        },
      ],
    } as RuleResponse["condition"];
    const draft = draftFromRule(rule({ condition }));
    expect(draftToRequest(draft).condition).toEqual(condition);
  });

  it("folds a matching actuator clear into 'turn back on clear'", () => {
    const draft = draftFromRule(
      rule({
        clear_actions: [
          { type: "actuator_command", device_id: DEV_B, actuator: "fan1", value: false },
        ],
      }),
    );
    const fan = draft.actions[0] as ActuatorActionDraft;
    expect(fan.revertOnClear).toBe(true);
    expect(draftToRequest(draft).clear_actions).toEqual([
      { type: "actuator_command", device_id: DEV_B, actuator: "fan1", value: false },
    ]);
  });

  it("passes through clear actions the editors don't model", () => {
    const hook = { type: "webhook", url: "https://x.test", body: {} };
    const emailingNotice = { type: "notification", message: "ok", channels: ["platform", "email"] };
    const draft = draftFromRule(rule({ clear_actions: [hook, emailingNotice] }));
    expect(draft.clearNotify).toBe(false);
    expect(draftToRequest(draft).clear_actions).toEqual([hook, emailingNotice]);
  });

  it("turns a notification's email channel into a parallel Email action", () => {
    const draft = draftFromRule(
      rule({
        name: "Boiler",
        actions: [{ type: "notification", message: "hot", channels: ["platform", "email"] }],
      }),
    );
    expect(draft.actions.map((a) => a.kind)).toEqual(["notification", "email"]);
    expect(draftToRequest(draft).actions).toEqual([
      { type: "notification", message: "hot", channels: ["platform"] },
      { type: "email", to: [], subject: "[Boiler] alert", body: "hot" },
    ]);
  });

  it("maps latch both ways and keeps its reset condition", () => {
    const reset = rule({}).condition;
    const draft = draftFromRule(
      rule({
        execution_policy: {
          strategy: "latch",
          for_duration: 0,
          cooldown: 0,
          reset_condition: reset,
          clear_for_duration: 0,
        },
      }),
    );
    expect(draft.behaviour).toBe("latch");
    const policy = draftToRequest(draft).execution_policy as Record<string, unknown>;
    expect(policy.strategy).toBe("latch");
    expect(policy.reset_condition).toEqual(reset);
  });

  it("keeps an API-authored strategy it doesn't offer", () => {
    const draft = draftFromRule(
      rule({
        execution_policy: {
          strategy: "continuous",
          for_duration: 0,
          cooldown: 30,
          reset_condition: null,
          clear_for_duration: 0,
        },
      }),
    );
    expect(draft.behaviour).toBe("other");
    expect((draftToRequest(draft).execution_policy as Record<string, unknown>).strategy).toBe(
      "continuous",
    );
  });
});

describe("draftToRequest", () => {
  function scheduled(): RuleDraft {
    const d = emptyDraft(DEV_A);
    d.when = { ...d.when, type: "schedule", cron: "0 8 * * *" };
    d.condition = null;
    d.behaviour = "latch";
    const fan = { ...(d.actions[0] as ActuatorActionDraft), actuator: "pump", revertOnClear: true };
    d.actions = [fan];
    return d;
  }

  it("sends a condition-less schedule with no hold, no latch, no clear", () => {
    const body = draftToRequest(scheduled());
    expect(body.trigger).toEqual({ type: "schedule", cron: "0 8 * * *", timezone: "UTC" });
    expect(body.condition).toBeNull();
    expect(body.execution_policy).toMatchObject({
      strategy: "edge",
      for_duration: 0,
      clear_for_duration: 0,
    });
    expect(body.clear_actions).toEqual([]);
  });

  it("drops clear actions for a latch rule", () => {
    const d = emptyDraft(DEV_A);
    d.condition = contact("t");
    d.behaviour = "latch";
    d.actions = [{ ...(d.actions[0] as ActuatorActionDraft), actuator: "fan", revertOnClear: true }];
    d.clearNotify = true;
    d.clearMessage = "back";
    expect(draftToRequest(d).clear_actions).toEqual([]);
  });

  it("sends parallel actions in order, with parsed email recipients", () => {
    const d = emptyDraft(DEV_A);
    d.condition = contact("t");
    d.actions = [
      { ...(emptyAction("actuator", DEV_A) as ActuatorActionDraft), actuator: "fan" },
      { ...(emptyAction("actuator", DEV_B) as ActuatorActionDraft), actuator: "siren" },
      { kind: "email", id: "e", to: "a@x.io, b@x.io", subject: "Hot", body: "Too hot" },
      { kind: "webhook", id: "w", url: "https://h.test", body: '{"k": 1}' },
    ];
    expect(draftToRequest(d).actions).toEqual([
      { type: "actuator_command", device_id: DEV_A, actuator: "fan", value: true },
      { type: "actuator_command", device_id: DEV_B, actuator: "siren", value: true },
      { type: "email", to: ["a@x.io", "b@x.io"], subject: "Hot", body: "Too hot" },
      { type: "webhook", url: "https://h.test", body: { k: 1 } },
    ]);
  });

  it("zeroes hysteresis on operators that can't latch", () => {
    const c = { ...contact("sw"), operator: "==", hysteresis: 1 };
    expect(conditionFromNode(c)).toMatchObject({ operator: "==", hysteresis: 0 });
  });
});

describe("validateDraft", () => {
  it("requires a condition only for reading rules", () => {
    const d = emptyDraft(DEV_A);
    d.condition = null;
    d.actions = [{ kind: "notification", id: "n", message: "hi" }];
    expect(validateDraft(d)).toMatch(/condition/);
    d.when = { ...d.when, type: "manual" };
    expect(validateDraft(d)).toBeNull();
  });

  it("rejects a malformed email recipient", () => {
    const d = emptyDraft(DEV_A);
    d.condition = contact("t");
    d.actions = [{ kind: "email", id: "e", to: "ops@x.io, nope", subject: "s", body: "b" }];
    expect(validateDraft(d)).toMatch(/nope/);
  });

  it("flags flapping only for a zero-hysteresis inequality that reverts with no delay", () => {
    const d = emptyDraft(DEV_A);
    d.condition = { ...contact("t"), hysteresis: 0 };
    d.actions = [{ ...(d.actions[0] as ActuatorActionDraft), actuator: "fan", revertOnClear: true }];
    expect(flappingRisk(d)).toBe(true);
    d.clearDelay = 5;
    expect(flappingRisk(d)).toBe(false);
  });
});

describe("emptyDraft", () => {
  it("starts schedules in the workspace time zone, UTC by default", () => {
    expect(emptyDraft(DEV_A).when.timezone).toBe("UTC");
    expect(emptyDraft(DEV_A, "Europe/Madrid").when.timezone).toBe("Europe/Madrid");
  });
});
