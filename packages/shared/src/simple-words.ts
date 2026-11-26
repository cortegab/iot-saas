/**
 * The words each view uses (DESIGN.md §15a, §11; ease-of-use C4). Full view
 * keeps the integrator's terms; Simple view says what a client recognizes.
 * Labels only: the API, URLs and keys never change.
 */
import { tActive } from "./i18n";

export interface Words {
  template: string;
  templates: string;
  zone: string;
  zones: string;
  rule: string;
  rules: string;
  metric: string;
  actuator: string;
}

const KEYS: (keyof Words)[] = ["template", "templates", "zone", "zones", "rule", "rules", "metric", "actuator"];

/** The words of this view, in the language on screen (DESIGN.md §11a). */
export function words(simple: boolean): Words {
  const view = simple ? "simple" : "full";
  return Object.fromEntries(KEYS.map((k) => [k, tActive(`words.${view}.${k}`)])) as unknown as Words;
}

/** "device type" → "Device type". */
export function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
