import { describe, expect, it } from "vitest";
import { validateDraft } from "./rule-draft";
import { recipesFor, type RecipeDevice } from "./rule-recipes";

const climate: RecipeDevice = {
  id: "dev-1",
  name: "bay1-climate",
  metrics: [
    { key: "temperature", name: "Temperature", data_type: "float", unit: "°C", min: 0, max: 40 },
    { key: "humidity", name: "Humidity", data_type: "float", unit: "%" },
    { key: "door", name: "Door", data_type: "bool" },
  ],
  actuators: [{ key: "fan1", name: "Fan", value_type: "bool" }],
};

const pumphouse: RecipeDevice = {
  id: "dev-2",
  name: "pumphouse",
  metrics: [{ key: "tank_level", name: "Tank level", data_type: "float", unit: "%" }],
  actuators: [{ key: "pump1", name: "Pump", value_type: "bool" }],
};

describe("recipesFor", () => {
  it("offers what the device can do", () => {
    expect(recipesFor(climate).map((r) => r.id)).toEqual(["too-hot", "door-open", "humidity-low", "offline", "schedule"]);
    expect(recipesFor(pumphouse).map((r) => r.id)).toEqual(["too-hot", "tank-low", "offline", "schedule"]);
    expect(recipesFor({ id: "x", name: "bare", metrics: [], actuators: [] }).map((r) => r.id)).toEqual(["offline"]);
  });

  it("every recipe is a valid draft as generated", () => {
    for (const r of [...recipesFor(climate), ...recipesFor(pumphouse)]) {
      expect(validateDraft(r.draft), r.id).toBeNull();
    }
  });

  it("keeps flapping protection on hardware recipes", () => {
    const hot = recipesFor(climate).find((r) => r.id === "too-hot")!;
    expect(hot.tags).toContain("switches hardware");
    expect(hot.draft.forDuration).toBeGreaterThanOrEqual(5);
    expect(hot.draft.cooldown).toBeGreaterThanOrEqual(30);
    expect(hot.draft.condition && hot.draft.condition.kind === "contact" && hot.draft.condition.hysteresis).toBeGreaterThan(0);
    // Threshold lands inside the declared range (75 % of 0–40).
    expect(hot.draft.condition && hot.draft.condition.kind === "contact" && hot.draft.condition.value).toBe(30);
  });

  it("the tank recipe latches and stops the pump", () => {
    const tank = recipesFor(pumphouse).find((r) => r.id === "tank-low")!;
    expect(tank.draft.behaviour).toBe("latch");
    expect(tank.tags).toEqual(["switches hardware", "latches"]);
    const a = tank.draft.actions[0];
    expect(a.kind === "actuator" && a.bool).toBe(false);
  });

  it("schedules start in the given time zone", () => {
    const s = recipesFor(climate, "Europe/Madrid").find((r) => r.id === "schedule")!;
    expect(s.draft.when).toMatchObject({ type: "schedule", cron: "0 22 * * *", timezone: "Europe/Madrid" });
  });
});
