import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE,
  clampRepeat,
  cronFromSchedule,
  cronHuman,
  nextRuns,
  runText,
  scheduleFromCron,
  validateCron,
  type ScheduleModel,
} from "@/lib/schedule";
import { offsetMinutes, timezoneOptions, tzLabel, tzOffset } from "@/lib/timezones";

const model = (m: Partial<ScheduleModel>): ScheduleModel => ({ ...DEFAULT_SCHEDULE, ...m });

describe("cron ⇄ schedule modes", () => {
  it.each([
    ["0 22 * * *", { mode: "daily", time: "22:00" }],
    ["30 7 * * 2,4", { mode: "days", time: "07:30", days: [2, 4] }],
    ["0 8 * * 1-5", { mode: "days", time: "08:00", days: [1, 2, 3, 4, 5] }],
    ["*/15 * * * *", { mode: "every", n: 15, unit: "min" }],
    ["5 */2 * * *", { mode: "every", n: 2, unit: "h", at: 5 }],
    ["0 * * * *", { mode: "every", n: 1, unit: "h", at: 0 }],
    ["0 9 1 * *", { mode: "monthly", time: "09:00", dom: 1 }],
  ])("%s reads as a simple mode", (cron, expected) => {
    expect(scheduleFromCron(cron)).toMatchObject(expected);
  });

  it.each(["0 22 * 1 *", "0 9 31 * *", "0 8,20 * * 1-5", "1-10 3 * * *", "garbage", "0 25 * * *"])(
    "%s opens in Custom",
    (cron) => {
      expect(scheduleFromCron(cron).mode).toBe("custom");
    },
  );

  it.each(["0 22 * * *", "30 7 * * 2,4", "0 8 * * 1-5", "*/15 * * * *", "5 */2 * * *", "0 * * * *", "0 9 1 * *"])(
    "%s round-trips",
    (cron) => {
      const s = model(scheduleFromCron(cron));
      expect(cronFromSchedule(s)).toBe(cron);
    },
  );

  it("writes weekdays as a range and custom as null", () => {
    expect(cronFromSchedule(model({ mode: "days", time: "08:00", days: [5, 1, 3, 2, 4] }))).toBe("0 8 * * 1-5");
    expect(cronFromSchedule(model({ mode: "custom" }))).toBeNull();
  });

  it("clamps repeat intervals to 1–59 min and 1–23 h", () => {
    expect(clampRepeat(0, "min")).toBe(1);
    expect(clampRepeat(90, "min")).toBe(59);
    expect(clampRepeat(40, "h")).toBe(23);
  });
});

describe("plain wording", () => {
  it.each([
    ["0 22 * * *", "every day at 22:00"],
    ["30 7 * * 2,4", "Tue, Thu at 07:30"],
    ["0 8 * * 1-5", "weekdays at 08:00"],
    ["0 10 * * 0,6", "weekends at 10:00"],
    ["*/15 * * * *", "every 15 min"],
    ["0 9 1 * *", "on the 1st of each month at 09:00"],
    ["0 8,20 * * 1-5", "weekdays at 08:00 and 20:00"],
    ["0 22 * 1 *", "on a custom schedule"],
    ["nope", "invalid schedule"],
  ])("%s → %s", (cron, text) => {
    expect(cronHuman(cron)).toBe(text);
  });
});

describe("custom validation", () => {
  it("accepts numbers, *, ranges, lists and steps", () => {
    expect(validateCron("*/5 8-18 1,15 * 1-5")).toBeNull();
  });
  it("explains a wrong field count", () => {
    expect(validateCron("0 22 * *")).toMatch(/five fields/);
  });
  it("explains an unreadable field", () => {
    expect(validateCron("0 24 * * *")).toMatch(/isn't valid/);
    expect(validateCron("0 x * * *")).toMatch(/isn't valid/);
  });
});

describe("next runs in the rule's time zone", () => {
  // Wed 30 Sep 2026 12:00 UTC = 06:00 in Mexico City (GMT-6), 14:00 in Oslo (GMT+2).
  const from = new Date(Date.UTC(2026, 8, 30, 12, 0));

  it("computes weekday runs on the zone's wall clock", () => {
    const runs = nextRuns("0 22 * * 1-5", "America/Mexico_City", 3, from).map((r) => runText(r, "America/Mexico_City", from));
    expect(runs).toEqual(["Today 22:00", "Tomorrow 22:00", "Fri 2 Oct 22:00"]);
  });

  it("skips a time that already passed today in that zone", () => {
    const runs = nextRuns("0 13 * * *", "Europe/Oslo", 2, from).map((r) => runText(r, "Europe/Oslo", from));
    expect(runs).toEqual(["Tomorrow 13:00", "Fri 2 Oct 13:00"]);
  });

  it("handles minute repeats", () => {
    const runs = nextRuns("*/15 * * * *", "UTC", 3, from).map((r) => runText(r, "UTC", from));
    expect(runs).toEqual(["Today 12:15", "Today 12:30", "Today 12:45"]);
  });

  it("returns nothing for an invalid cron", () => {
    expect(nextRuns("bad", "UTC", 3, from)).toEqual([]);
  });
});

describe("time zone labels", () => {
  const winter = new Date(Date.UTC(2026, 0, 15));
  const summer = new Date(Date.UTC(2026, 6, 15));

  it("labels City (GMT±h) with today's offset", () => {
    expect(tzLabel("America/Mexico_City", winter)).toBe("Mexico City (GMT-6)");
    expect(tzLabel("Europe/Oslo", summer)).toBe("Oslo (GMT+2)");
    expect(tzLabel("Europe/Oslo", winter)).toBe("Oslo (GMT+1)");
    expect(tzOffset("UTC", winter)).toBe("GMT+0");
  });

  it("parses offsets with minutes", () => {
    expect(offsetMinutes("GMT+5:30")).toBe(330);
    expect(offsetMinutes("GMT-6")).toBe(-360);
  });

  it("groups sorted by offset and keeps an unlisted stored zone", () => {
    const { extra, groups } = timezoneOptions("Asia/Kathmandu", winter);
    expect(extra?.value).toBe("Asia/Kathmandu");
    expect(groups.map((g) => g.label)).toEqual(["Americas", "Europe & Africa", "Asia & Pacific", "Other"]);
    const americas = groups[0].options.map((o) => o.value);
    expect(americas[0]).toBe("America/Anchorage");
    expect(timezoneOptions("UTC", winter).extra).toBeNull();
  });
});
