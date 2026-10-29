import { describe, expect, it } from "vitest";
import { clampPage, pageItems } from "@/components/list/usePager";
import { pageKey } from "@/components/list/useServerPager";

describe("clampPage", () => {
  it("keeps the page inside 1..pageCount", () => {
    expect(clampPage(1, 120, 25)).toEqual({ page: 1, pageCount: 5 });
    expect(clampPage(9, 120, 25)).toEqual({ page: 5, pageCount: 5 });
    expect(clampPage(0, 120, 25)).toEqual({ page: 1, pageCount: 5 });
  });

  it("has one page when the list is empty or short", () => {
    expect(clampPage(3, 0, 25)).toEqual({ page: 1, pageCount: 1 });
    expect(clampPage(1, 25, 25)).toEqual({ page: 1, pageCount: 1 });
  });
});

describe("pageItems", () => {
  it("lists every page up to seven", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps seven slots: first, last, the current page and its neighbours", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, "…", 20]);
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, "…", 20]);
    expect(pageItems(5, 20)).toEqual([1, "…", 4, 5, 6, "…", 20]);
    expect(pageItems(16, 20)).toEqual([1, "…", 15, 16, 17, "…", 20]);
    expect(pageItems(17, 20)).toEqual([1, "…", 16, 17, 18, 19, 20]);
    expect(pageItems(20, 20)).toEqual([1, "…", 16, 17, 18, 19, 20]);
    expect(pageItems(3, 8)).toEqual([1, 2, 3, 4, 5, "…", 8]);
  });
});

describe("pageKey", () => {
  it("is the feed path, then limit, offset and the filters that are set", () => {
    expect(pageKey("/devices/d1/commands", 1, 25)).toBe("/devices/d1/commands?limit=25&offset=0");
    expect(pageKey("/devices/d1/commands", 3, 50, { status: "pending", actuator: null })).toBe(
      "/devices/d1/commands?limit=50&offset=100&status=pending",
    );
  });

  it("starts with the path and a '?', which useRealtime's feed revalidation matches", () => {
    const path = "/rules/r1/executions";
    expect(pageKey(path, 2, 25).startsWith(`${path}?`)).toBe(true);
  });
});
