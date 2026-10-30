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
  icon: "fan" | "door" | "droplet" | "pump" | "offline" | "clock";
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
    d.name = `${temp.name} high → ${fan.name} on`;
    out.push({
      id: "too-hot",
      title: `Turn on ${fan.name} when it's too hot`,
      description: `Above ${limit}${temp.unit ? ` ${temp.unit}` : ""} for 10 s, switch ${fan.name} on; off again once it drops back.`,
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
    d.actions = [{ ...emptyAction("email", device.id), subject: `${door.name} left open on ${device.name}`, body: `${door.name} on ${device.name} has been open for 2 minutes.` } as RuleDraft["actions"][number]];
    d.name = `${door.name} open too long`;
    out.push({
      id: "door-open",
      title: `Alert when ${door.name.toLowerCase()} stays open`,
      description: "Emails the workspace's alert recipients after 2 minutes open.",
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
    d.actions = [{ ...emptyAction("notification", device.id), message: `${humidity.name} on ${device.name} is below ${limit}.` } as RuleDraft["actions"][number]];
    d.name = `${humidity.name} low`;
    out.push({
      id: "humidity-low",
      title: `Warn when ${humidity.name.toLowerCase()} drops`,
      description: `Below ${limit}${humidity.unit ? ` ${humidity.unit}` : ""} for 10 s, add a notification.`,
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
    d.name = `${level.name} low → stop ${pump.name}`;
    out.push({
      id: "tank-low",
      title: `Stop ${pump.name} when the tank is low`,
      description: `Below ${limit}${level.unit ? ` ${level.unit}` : ""}, switch ${pump.name} off and keep it off until someone resets the rule.`,
      icon: "pump",
      tags: ["switches hardware", "latches"],
      draft: d,
    });
  }

  {
    const d = base();
    d.when = { ...d.when, type: "device_status", statusDeviceId: device.id, transition: "disconnected" };
    d.condition = null;
    d.actions = [{ ...emptyAction("notification", device.id), message: `${device.name} went offline.` } as RuleDraft["actions"][number]];
    d.cooldown = DEFAULT_COOLDOWN;
    d.name = `${device.name} offline`;
    out.push({
      id: "offline",
      title: "Tell me when this device goes offline",
      description: `A notification when ${device.name} disconnects.`,
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
    d.name = `${a.name} on at 22:00`;
    out.push({
      id: "schedule",
      title: "Switch something on a schedule",
      description: `Switch ${a.name} on every day at 22:00; change the time and days in the editor.`,
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
    d.actions = [{ ...emptyAction("notification", ""), message: "A device went offline." } as RuleDraft["actions"][number]];
    d.cooldown = DEFAULT_COOLDOWN;
    d.name = "Device offline";
    generic.push({ id: "offline", title: "Tell me when a device goes offline", description: "A notification when the device you pick disconnects.", icon: "offline", tags: [], draft: d });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: ">", value: 30, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [switchOn(true, true)];
    d.name = "Too hot → switch on";
    generic.push({
      id: "too-hot",
      title: "Turn something on when it's too hot",
      description: "Above a limit for 10 s, switch something on; off again once it drops back.",
      icon: "fan",
      tags: ["switches hardware"],
      draft: d,
    });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: "==", value: 1, hysteresis: 0 };
    d.forDuration = 120;
    d.actions = [{ ...emptyAction("email", ""), subject: "Left open", body: "It has been open for 2 minutes." } as RuleDraft["actions"][number]];
    d.name = "Door open too long";
    generic.push({ id: "door-open", title: "Alert when a door stays open", description: "Emails the workspace's alert recipients after 2 minutes open.", icon: "door", tags: ["email"], draft: d });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: "<", value: 40, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [{ ...emptyAction("notification", ""), message: "Humidity is low." } as RuleDraft["actions"][number]];
    d.name = "Humidity low";
    generic.push({ id: "humidity-low", title: "Warn when humidity drops", description: "Below a limit for 10 s, add a notification.", icon: "droplet", tags: [], draft: d });
  }
  {
    const d = base();
    d.condition = { ...emptyContact(""), operator: "<", value: 20, hysteresis: DEFAULT_HYSTERESIS };
    d.actions = [switchOn(false, false)];
    d.behaviour = "latch";
    d.name = "Tank low → stop pump";
    generic.push({
      id: "tank-low",
      title: "Stop the pump when the tank is low",
      description: "Below a limit, switch the pump off and keep it off until someone resets the rule.",
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
    d.name = "On at 22:00";
    generic.push({
      id: "schedule",
      title: "Switch something on a schedule",
      description: "Every day at 22:00; change the time and days in the editor.",
      icon: "clock",
      tags: ["switches hardware"],
      draft: d,
    });
  }

  const ready = generic.map((g) => filled.find((f) => f.id === g.id) ?? g);
  // From a device page: what it can run first, already filled with it.
  return [...ready.filter((r) => filled.includes(r)), ...ready.filter((r) => !filled.includes(r))];
}
