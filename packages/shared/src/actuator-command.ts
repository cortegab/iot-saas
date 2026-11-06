/** What a device's actuator control offers and accepts (DESIGN.md §8
 * Controls). Pure, so it's unit-tested. */
import type { components } from "./api";

type CatalogActuator = components["schemas"]["CatalogActuator"];
type HardwareConfig = components["schemas"]["HardwareConfig"];

export type CommandValue = boolean | number | string;

/** `switch` for On / Off (also for an actuator a rule drives that the template
 * doesn't declare), `choices` for a fixed list of values, `number` / `text`
 * for a value typed in and Set. */
export type ControlKind = "switch" | "choices" | "number" | "text";

export function controlKind(def: CatalogActuator | undefined): ControlKind {
  if (!def || def.value_type === "bool") return "switch";
  if (def.allowed_values?.length) return "choices";
  return def.value_type === "float" ? "number" : "text";
}

export interface CommandRange {
  min: number;
  max: number;
  unit?: string;
}

/** The range a number actuator takes, from the part it's wired to (the
 * device's own wiring, else its template's): a PWM output's "Command for
 * 0% / 100%", a servo's min / max angle. Defaults match firmware/drivers.json.
 * Null when it isn't wired to such a part (own code, no wiring). */
export function commandRange(wiring: HardwareConfig | null | undefined, actuatorId: string): CommandRange | null {
  const binding = wiring?.outputs?.find((b) => Object.values(b.channels ?? {}).includes(actuatorId));
  if (!binding) return null;
  const num = (key: string, fallback: number) => {
    const v = binding.params?.[key];
    return typeof v === "number" ? v : fallback;
  };
  const span = (a: number, b: number, unit?: string): CommandRange => ({ min: Math.min(a, b), max: Math.max(a, b), unit });
  if (binding.driver === "pwm") return span(num("in_min", 0), num("in_max", 100));
  if (binding.driver === "servo") return span(num("min_angle", 0), num("max_angle", 180), "°");
  return null;
}

/** A typed-in value, checked against the actuator's kind and range. */
export function parseCommand(text: string, kind: "number" | "text", range: CommandRange | null): { value: CommandValue } | { error: string } {
  const raw = text.trim();
  if (!raw) return { error: "Enter a value." };
  if (kind === "text") return { value: raw };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: "Enter a number." };
  if (range && (n < range.min || n > range.max)) return { error: `Between ${range.min} and ${range.max}${range.unit ?? ""}.` };
  return { value: n };
}

/** Whether `next` is the value already requested: the control doesn't send it
 * again (Retry, after No response, is the only resend). */
export function isRequested(next: CommandValue, requested: unknown): boolean {
  return requested !== null && requested !== undefined && JSON.stringify(next) === JSON.stringify(requested);
}
