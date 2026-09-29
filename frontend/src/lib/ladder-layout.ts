/**
 * Grid layout for one ladder rung, derived from the condition tree — pure,
 * unit-tested (`ladder-layout.test.ts`).
 *
 * Coordinates are grid units: a contact fills one cell (1 wide, 1 tall);
 * series blocks sit side by side (widths add, height is the tallest), and
 * parallel blocks stack (heights add, width is the widest). Every block is
 * entered at its top-left corner and left at its top-right corner, so a
 * block's "main row" is always its first row. A parallel branch narrower than
 * its block is extended with a wire to the right bus, and each vertical bus
 * spans only its own block's rows — which keeps the drawing electrically
 * identical to the AND/OR tree.
 */

import type { DraftNode } from "@/lib/rule-draft";

export interface LadderContact {
  id: string;
  /** Left column of the cell. */
  x: number;
  /** Row of the cell. */
  y: number;
}

export interface LadderBlock {
  id: string;
  op: "AND" | "OR";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LadderWire {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LadderLayout {
  width: number;
  height: number;
  contacts: LadderContact[];
  /** Group bounding boxes — for highlighting a selected block. */
  blocks: LadderBlock[];
  /** Horizontal fillers and vertical buses between contacts. */
  wires: LadderWire[];
}

export function layoutCondition(node: DraftNode | null): LadderLayout {
  const out: LadderLayout = { width: 0, height: 1, contacts: [], blocks: [], wires: [] };
  if (node === null) return out;
  const size = place(node, 0, 0, out);
  out.width = size.width;
  out.height = size.height;
  return out;
}

function place(
  node: DraftNode,
  x: number,
  y: number,
  out: LadderLayout,
): { width: number; height: number } {
  if (node.kind === "contact") {
    out.contacts.push({ id: node.id, x, y });
    return { width: 1, height: 1 };
  }

  if (node.op === "AND") {
    let width = 0;
    let height = 0;
    for (const child of node.children) {
      const size = place(child, x + width, y, out);
      width += size.width;
      height = Math.max(height, size.height);
    }
    out.blocks.push({ id: node.id, op: "AND", x, y, width, height });
    return { width, height };
  }

  // OR: lay out every branch first to learn the block width, then wire the
  // shorter branches out to the right bus.
  const branches: { row: number; width: number }[] = [];
  let height = 0;
  let width = 0;
  for (const child of node.children) {
    const size = place(child, x, y + height, out);
    branches.push({ row: y + height, width: size.width });
    height += size.height;
    width = Math.max(width, size.width);
  }
  for (const b of branches) {
    if (b.width < width) out.wires.push({ x1: x + b.width, y1: b.row, x2: x + width, y2: b.row });
  }
  const lastRow = branches[branches.length - 1].row;
  out.wires.push({ x1: x, y1: y, x2: x, y2: lastRow });
  out.wires.push({ x1: x + width, y1: y, x2: x + width, y2: lastRow });
  out.blocks.push({ id: node.id, op: "OR", x, y, width, height });
  return { width, height };
}

/** The ids from the root down to `id` (inclusive) — the selection
 * breadcrumb: a contact, then each block that encloses it. */
export function ancestry(node: DraftNode | null, id: string): DraftNode[] {
  if (node === null) return [];
  if (node.id === id) return [node];
  if (node.kind === "group") {
    for (const child of node.children) {
      const path = ancestry(child, id);
      if (path.length > 0) return [node, ...path];
    }
  }
  return [];
}
