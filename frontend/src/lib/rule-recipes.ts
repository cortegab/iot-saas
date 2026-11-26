/**
 * Rule recipes (DESIGN.md §9.1): starting points generated from what one
 * device can do. Each is an ordinary RuleDraft — there is no recipe entity
 * in the backend, and every recipe still passes through the editor's
 * validation and safety checks before it can be saved.
 */
import { wireId } from "@/lib/wire-id";
import {
  DEFAULT_COOLDOWN,
  DEFAULT_HYSTERESIS,
  emptyAction,
  emptyContact,
  emptyDraft,
  type ActuatorActionDraft,
  type RuleDraft,
} from "@/lib/rule-draft";
import { tActive as t } from "@iodriven/shared/i18n";

export interface RecipeMetric {
  key?: string | null;
  name: string;
  data_type?: string | null;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
}

export interface RecipeActuator {
  key?: string | null;
  name: string;
  value_type?: string | null;
}

export interface RecipeDevice {
  id: string;
  name: string;
  metrics: RecipeMetric[];
  actuators: RecipeActuator[];
}

export type RecipeTag = "switches hardware" | "latches" | "email";

export interface Recipe {
  id: string;
  title: string;
  /** One line on what it does, with this device's names. */
  description: string;
  icon: "fan" | "door" | "droplet" | "pump" | "offline" | "clock" | "bell";
  tags: RecipeTag[];
  draft: RuleDraft;
}

const numeric = (m: RecipeMetric) => m.data_type !== "bool";
const isBool = (m: RecipeMetric) => m.data_type === "bool";
const switchable = (a: RecipeActuator) => (a.value_type ?? "bool") === "bool";
const match = <T extends { key?: string | null; name: string }>(items: T[], re: RegExp) =>
  items.find((x) => re.test(`${x.key ?? ""} ${x.name}`.toLowerCase()));

function actuatorAction(device: RecipeDevice, a: RecipeActuator, on: boolean, revert: boolean): ActuatorActionDraft {
  const base = emptyAction("actuator", device.id) as ActuatorActionDraft;
  return { ...base, actuator: wireId(a), bool: on, revertOnClear: revert };
}

/** A threshold inside the metric's declared range, or a sensible default. */
function threshold(m: RecipeMetric, fraction: number, fallback: number): number {
  if (m.min != null && m.max != null && m.max > m.min) return Math.round(m.min + (m.max - m.min) * fraction);
  return fallback;
}

export function recipesFor(device: RecipeDevice, timezone = "UTC"): Recipe[] {
  const out: Recipe[] = [];
  const base = () => emptyDraft(device.id, timezone);
  const actuators = device.actuators.filter(switchable);

  const temp = match(device.metrics.filter(numeric), /temp/) ?? device.metrics.find(numeric);
  const fan = match(actuators, /fan|cool|vent/) ?? actuators[0];
  if (temp && fan) {
    const limit = /temp/.test(`${temp.key ?? ""} ${temp.name}`.toLowerCase()) ? threshold(temp, 0.75, 30) : threshold(temp, 0.75, 50);
    const d = base();
    d.condition = { ...emptyContact(device.id), metric: wireId(temp), operator: ">", value: limit, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [actuatorAction(device, fan, true, true)];
    d.name = t("rules.recipes.tooHot.nameFor", { metric: temp.name, fan: fan.name });
    out.push({
      id: "too-hot",
      title: t("rules.recipes.tooHot.titleFor", { fan: fan.name }),
      description: t("rules.recipes.tooHot.descriptionFor", { limit: `${limit}${temp.unit ? ` ${temp.unit}` : ""}`, fan: fan.name }),
      icon: "fan",
      tags: ["switches hardware"],
      draft: d,
    });
  }

  const door = match(device.metrics.filter(isBool), /door|open|contact/);
  if (door) {
    const d = base();
    d.condition = { ...emptyContact(device.id), metric: wireId(door), operator: "==", value: 1, hysteresis: 0 };
    d.forDuration = 120;
    d.actions = [{ ...emptyAction("email", device.id), subject: t("rules.recipes.doorOpen.subjectFor", { door: door.name, device: device.name }), body: t("rules.recipes.doorOpen.bodyFor", { door: door.name, device: device.name }) } as RuleDraft["actions"][number]];
    d.name = t("rules.recipes.doorOpen.nameFor", { door: door.name });
    out.push({
      id: "door-open",
      title: t("rules.recipes.doorOpen.titleFor", { door: door.name.toLowerCase() }),
      description: t("rules.recipes.doorOpen.description"),
      icon: "door",
      tags: ["email"],
      draft: d,
    });
  }

  const humidity = match(device.metrics.filter(numeric), /hum/);
  if (humidity) {
    const limit = threshold(humidity, 0.3, 40);
    const d = base();
    d.condition = { ...emptyContact(device.id), metric: wireId(humidity), operator: "<", value: limit, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [{ ...emptyAction("notification", device.id), message: t("rules.recipes.humidityLow.messageFor", { metric: humidity.name, device: device.name, limit: String(limit) }) } as RuleDraft["actions"][number]];
    d.name = t("rules.recipes.humidityLow.nameFor", { metric: humidity.name });
    out.push({
      id: "humidity-low",
      title: t("rules.recipes.humidityLow.titleFor", { metric: humidity.name.toLowerCase() }),
      description: t("rules.recipes.humidityLow.descriptionFor", { limit: `${limit}${humidity.unit ? ` ${humidity.unit}` : ""}` }),
      icon: "droplet",
      tags: [],
      draft: d,
    });
  }

  const level = match(device.metrics.filter(numeric), /level|tank/);
  const pump = match(actuators, /pump/);
  if (level && pump) {
    const limit = threshold(level, 0.2, 20);
    const d = base();
    d.condition = { ...emptyContact(device.id), metric: wireId(level), operator: "<", value: limit, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [actuatorAction(device, pump, false, false)];
    d.behaviour = "latch";
    d.name = t("rules.recipes.tankLow.nameFor", { metric: level.name, pump: pump.name });
    out.push({
      id: "tank-low",
      title: t("rules.recipes.tankLow.titleFor", { pump: pump.name }),
      description: t("rules.recipes.tankLow.descriptionFor", { limit: `${limit}${level.unit ? ` ${level.unit}` : ""}`, pump: pump.name }),
      icon: "pump",
      tags: ["switches hardware", "latches"],
      draft: d,
    });
  }

  {
    const d = base();
    d.when = { ...d.when, type: "device_status", statusDeviceId: device.id, transition: "disconnected" };
    d.condition = null;
    d.actions = [{ ...emptyAction("notification", device.id), message: t("rules.recipes.offline.messageFor", { device: device.name }) } as RuleDraft["actions"][number]];
    d.cooldown = DEFAULT_COOLDOWN;
    d.name = t("rules.recipes.offline.nameFor", { device: device.name });
    out.push({
      id: "offline",
      title: t("rules.recipes.offline.titleFor"),
      description: t("rules.recipes.offline.descriptionFor", { device: device.name }),
      icon: "offline",
      tags: [],
      draft: d,
    });
  }

  if (actuators.length > 0) {
    const a = actuators[0];
    const d = base();
    d.when = { ...d.when, type: "schedule", cron: "0 22 * * *", timezone };
    d.condition = null;
    d.actions = [actuatorAction(device, a, true, false)];
    d.name = t("rules.recipes.schedule.nameFor", { output: a.name });
    out.push({
      id: "schedule",
      title: t("rules.recipes.schedule.title"),
      description: t("rules.recipes.schedule.descriptionFor", { output: a.name }),
      icon: "clock",
      tags: ["switches hardware"],
      draft: d,
    });
  }

  return out;
}

/** Every recipe, ready to start without a device (DESIGN.md §9.1): its parts
 * are in place and their devices are picked in the When / If / Then steps, so
 * one rule can read one device and switch another. Given `device` (New rule
 * from a device page), the recipes it can run come first, filled with it. */
export function recipeStarts(timezone = "UTC", device?: RecipeDevice): Recipe[] {
  const filled = device ? recipesFor(device, timezone) : [];
  const base = () => emptyDraft("", timezone);
  const switchOn = (on: boolean, revert: boolean): ActuatorActionDraft => ({ ...(emptyAction("actuator", "") as ActuatorActionDraft), bool: on, revertOnClear: revert });
  // Each starts with a suggested name, changed on Review.
  const generic: Recipe[] = [];

  {
    const d = base();
    d.when = { ...d.when, type: "device_status", statusDeviceId: "", transition: "disconnected" };
    d.condition = null;
    d.actions = [{ ...emptyAction("notification", ""), message: t("rules.recipes.offline.message") } as RuleDraft["actions"][number]];
    d.cooldown = DEFAULT_COOLDOWN;
    d.name = t("rules.recipes.offline.name");
    generic.push({ id: "offline", title: t("rules.recipes.offline.title"), description: t("rules.recipes.offline.description"), icon: "offline", tags: [], draft: d });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: ">", value: 30, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [switchOn(true, true)];
    d.name = t("rules.recipes.tooHot.name");
    generic.push({
      id: "too-hot",
      title: t("rules.recipes.tooHot.title"),
      description: t("rules.recipes.tooHot.description"),
      icon: "fan",
      tags: ["switches hardware"],
      draft: d,
    });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: "==", value: 1, hysteresis: 0 };
    d.forDuration = 120;
    d.actions = [{ ...emptyAction("email", ""), subject: t("rules.recipes.doorOpen.subject"), body: t("rules.recipes.doorOpen.body") } as RuleDraft["actions"][number]];
    d.name = t("rules.recipes.doorOpen.name");
    generic.push({ id: "door-open", title: t("rules.recipes.doorOpen.title"), description: t("rules.recipes.doorOpen.description"), icon: "door", tags: ["email"], draft: d });
  }
  {
    // Reached from a reading's "Alert me…" (ease-of-use B2), which fills the reading and a limit.
    const d = base();
    d.condition = { ...emptyContact(""), operator: ">", value: 30, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [{ ...emptyAction("notification", ""), message: t("rules.recipes.readingHigh.message") } as RuleDraft["actions"][number]];
    d.name = t("rules.recipes.readingHigh.name");
    generic.push({ id: "reading-high", title: t("rules.recipes.readingHigh.title"), description: t("rules.recipes.readingHigh.description"), icon: "bell", tags: [], draft: d });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: "<", value: 40, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [{ ...emptyAction("notification", ""), message: t("rules.recipes.humidityLow.message") } as RuleDraft["actions"][number]];
    d.name = t("rules.recipes.humidityLow.name");
    generic.push({ id: "humidity-low", title: t("rules.recipes.humidityLow.title"), description: t("rules.recipes.humidityLow.description"), icon: "droplet", tags: [], draft: d });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: "<", value: 20, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [switchOn(false, false)];
    d.behaviour = "latch";
    d.name = t("rules.recipes.tankLow.name");
    generic.push({
      id: "tank-low",
      title: t("rules.recipes.tankLow.title"),
      description: t("rules.recipes.tankLow.description"),
      icon: "pump",
      tags: ["switches hardware", "latches"],
      draft: d,
    });
  }
  {
    const d = base();
    d.when = { ...d.when, type: "schedule", cron: "0 22 * * *", timezone };
    d.condition = null;
    d.actions = [switchOn(true, false)];
    d.name = t("rules.recipes.schedule.name");
    generic.push({
      id: "schedule",
      title: t("rules.recipes.schedule.title"),
      description: t("rules.recipes.schedule.description"),
      icon: "clock",
      tags: ["switches hardware"],
      draft: d,
    });
  }

  const ready = generic.map((g) => filled.find((f) => f.id === g.id) ?? g);
  // From a device page: what it can run first, already filled with it.
  return [...ready.filter((r) => filled.includes(r)), ...ready.filter((r) => !filled.includes(r))];
}
