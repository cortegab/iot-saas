/**
 * The words each view uses (DESIGN.md §15a, §11; ease-of-use C4). Full view
 * keeps the integrator's terms; Simple view says what a client recognizes.
 * Labels only: the API, URLs and keys never change.
 */
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

const FULL: Words = {
  template: "template",
  templates: "templates",
  zone: "zone",
  zones: "zones",
  rule: "rule",
  rules: "rules",
  metric: "metric",
  actuator: "actuator",
};

const SIMPLE: Words = {
  template: "device type",
  templates: "device types",
  zone: "area",
  zones: "areas",
  rule: "automation",
  rules: "automations",
  metric: "reading",
  actuator: "output",
};

export function words(simple: boolean): Words {
  return simple ? SIMPLE : FULL;
}

/** "device type" → "Device type". */
export function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
