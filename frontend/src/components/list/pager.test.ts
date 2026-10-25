import { describe, expect, it } from "vitest";
import { clampPage } from "@/components/list/usePager";
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
