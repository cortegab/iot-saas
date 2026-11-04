import { describe, expect, it } from "vitest";
import { formatWhen, timeAgo } from "./time-ago";

describe("timeAgo", () => {
  const now = Date.UTC(2026, 8, 30, 12, 0);
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();

  it.each([
    [0, "just now"],
    [12, "12 min ago"],
    [180, "3 h ago"],
    [60 * 24 * 2, "2 d ago"],
  ])("%i minutes → %s", (min, text) => {
    expect(timeAgo(ago(min), now)).toBe(text);
  });

  it("says never for a missing time", () => {
    expect(timeAgo(null, now)).toBe("never");
  });

  it("switches to an absolute 24-hour date after a week", () => {
    expect(formatWhen("2026-10-02T22:00:00Z", "UTC")).toBe("Fri 2 Oct 22:00");
  });
});
