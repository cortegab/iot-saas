import { describe, expect, it } from "vitest";
import { matchesQuery, paginate, sortRows } from "@/components/list/useListState";

describe("list helpers", () => {
  it("matches every word anywhere in the haystack", () => {
    expect(matchesQuery("bay clim", "bay1-climate", "Climate node")).toBe(true);
    expect(matchesQuery("pump", "bay1-climate")).toBe(false);
    expect(matchesQuery("  ", "anything")).toBe(true);
  });

  it("sorts numbers and text, nulls last", () => {
    const rows = [{ n: "b", v: 2 }, { n: "a", v: null }, { n: "c", v: 1 }];
    expect(sortRows(rows, { key: "v", dir: "asc" }, (r, k) => (k === "v" ? r.v : r.n)).map((r) => r.n)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, { key: "n", dir: "desc" }, (r) => r.n).map((r) => r.n)).toEqual(["c", "b", "a"]);
  });

  it("paginates and clamps the page", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);
    expect(paginate(rows, 2, 25)).toEqual({ pageRows: [25, 26, 27, 28, 29], pageCount: 2, page: 2 });
    expect(paginate(rows, 9, 25).page).toBe(2);
  });
});
