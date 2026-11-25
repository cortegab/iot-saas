import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BoardModel, DriverSpec } from "@/lib/hardware/driver-catalog";
import { blankHardware, type HardwareCatalog } from "@/lib/hardware/hardware-draft";
import { STARTER_KITS, applyKit, kitsFor } from "@/lib/starter-kits";
import { blankTemplate, validateTemplate, type TemplateDraft } from "@/lib/template-draft";

const read = <T,>(file: string) => JSON.parse(readFileSync(new URL(`../../../firmware/${file}`, import.meta.url), "utf8")) as T;
const CATALOG: HardwareCatalog = { drivers: read<{ drivers: DriverSpec[] }>("drivers.json").drivers, models: read<{ models: BoardModel[] }>("boards.json").models };
const fresh = (): TemplateDraft => ({ ...blankTemplate("generic_firmware"), name: "Bay 1", hardware: blankHardware() });
const kit = (id: string) => STARTER_KITS.find((k) => k.id === id)!;

describe("starter kits", () => {
  it("are all buildable with this firmware", () => {
    expect(kitsFor(CATALOG).map((k) => k.id)).toEqual(STARTER_KITS.map((k) => k.id));
    expect(kitsFor(undefined)).toEqual([]);
  });

  it("greenhouse: a DHT22 and a relay, named, wired to free pins, and valid", () => {
    const d = applyKit(fresh(), kit("greenhouse"), CATALOG);
    // Friendlier names; keys stay what the part proposed (stable topic segments).
    expect(d.metrics.map((m) => [m.name, m.key])).toEqual([
      ["Air temperature", "temperature"],
      ["Humidity", "humidity"],
    ]);
    expect(d.actuators.map((a) => a.name)).toEqual(["Fan"]);
    expect(d.actuators[0].key).not.toBe("");
    const pins = [...d.hardware!.inputs, ...d.hardware!.outputs].flatMap((b) => Object.values(b.pins));
    expect(pins.every((p) => p != null)).toBe(true);
    expect(new Set(pins).size).toBe(pins.length);
    expect(validateTemplate(d, { otherNames: [], catalog: CATALOG }).errors).toEqual({});
  });

  it("replaces parts already there instead of piling on", () => {
    const twice = applyKit(applyKit(fresh(), kit("greenhouse"), CATALOG), kit("door"), CATALOG);
    expect(twice.metrics.map((m) => m.name)).toEqual(["Door open"]);
    expect(twice.actuators).toEqual([]);
    expect(twice.hardware!.inputs.map((b) => b.driver)).toEqual(["digital_in"]);
  });

  it("every kit makes a template that saves", () => {
    for (const k of STARTER_KITS) {
      const d = applyKit(fresh(), k, CATALOG);
      expect(validateTemplate(d, { otherNames: [], catalog: CATALOG }).errors, k.id).toEqual({});
      expect(d.metrics.length + d.actuators.length, k.id).toBeGreaterThan(0);
    }
  });
});
