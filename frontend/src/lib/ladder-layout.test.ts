import { describe, expect, it } from "vitest";
import { ancestry, layoutCondition } from "@/lib/ladder-layout";
import { emptyContact, insertBeside, type DraftNode } from "@/lib/rule-draft";

function named(metric: string) {
  return { ...emptyContact("dev"), metric };
}

describe("layoutCondition", () => {
  it("lays out an empty condition as a bare wire", () => {
    expect(layoutCondition(null)).toMatchObject({ width: 0, height: 1, contacts: [] });
  });

  it("puts series contacts side by side on one row", () => {
    const a = named("a");
    const b = named("b");
    const layout = layoutCondition(insertBeside(a, a.id, b, "AND"));
    expect(layout).toMatchObject({ width: 2, height: 1 });
    expect(layout.contacts).toEqual([
      { id: a.id, x: 0, y: 0 },
      { id: b.id, x: 1, y: 0 },
    ]);
    expect(layout.wires).toEqual([]);
  });

  it("stacks parallel branches, extends the short one, and draws both buses", () => {
    // A AND (B OR (C AND D)) — the OR block is 2 wide, B needs a filler.
    const [a, b, c, d] = ["a", "b", "c", "d"].map(named);
    let tree: DraftNode | null = insertBeside(a, a.id, b, "AND");
    tree = insertBeside(tree, b.id, c, "OR");
    tree = insertBeside(tree, c.id, d, "AND");
    const layout = layoutCondition(tree);
    expect(layout).toMatchObject({ width: 3, height: 2 });
    expect(layout.contacts).toEqual([
      { id: a.id, x: 0, y: 0 },
      { id: b.id, x: 1, y: 0 },
      { id: c.id, x: 1, y: 1 },
      { id: d.id, x: 2, y: 1 },
    ]);
    expect(layout.wires).toEqual([
      { x1: 2, y1: 0, x2: 3, y2: 0 }, // B's filler to the right bus
      { x1: 1, y1: 0, x2: 1, y2: 1 }, // left bus
      { x1: 3, y1: 0, x2: 3, y2: 1 }, // right bus
    ]);
  });
});

describe("ancestry", () => {
  it("returns the enclosing blocks from the root down to the node", () => {
    const [a, b, c] = ["a", "b", "c"].map(named);
    let tree: DraftNode | null = insertBeside(a, a.id, b, "AND");
    tree = insertBeside(tree, b.id, c, "OR");
    const path = ancestry(tree, c.id);
    expect(path.map((n) => (n.kind === "group" ? n.op : n.id))).toEqual(["AND", "OR", c.id]);
    expect(ancestry(tree, "missing")).toEqual([]);
  });
});
