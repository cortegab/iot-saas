import { describe, expect, it } from "vitest";
import { changeSummary, diffLines } from "@/lib/diff-summary";

type Rec = { name: string; enabled: boolean; to: string[] };
const fields = [
  { label: "Name", get: (r: Rec) => r.name },
  { label: "Status", get: (r: Rec) => r.enabled, format: (v: unknown) => (v ? "Enabled" : "Disabled") },
  { label: "Recipients", get: (r: Rec) => r.to },
];

describe("diff summary", () => {
  it("lists only changed fields, formatted", () => {
    const a: Rec = { name: "bay1", enabled: true, to: [] };
    const b: Rec = { name: "bay1-climate", enabled: false, to: [] };
    expect(diffLines(a, b, fields)).toEqual(["Name: bay1 → bay1-climate", "Status: Enabled → Disabled"]);
  });

  it("shows empty values as a dash and arrays joined", () => {
    expect(diffLines({ name: "x", enabled: true, to: [] }, { name: "x", enabled: true, to: ["a@b.c", "d@e.f"] }, fields)).toEqual([
      "Recipients: — → a@b.c, d@e.f",
    ]);
  });

  it("summarises one, several and many changes", () => {
    expect(changeSummary([])).toBe("No changes");
    expect(changeSummary(["Name: a → b"])).toBe("Name: a → b");
    expect(changeSummary(["A", "B"])).toBe("2 changes: A; B");
    expect(changeSummary(["A", "B", "C", "D"])).toBe("4 changes: A; B; +2 more");
  });
});
