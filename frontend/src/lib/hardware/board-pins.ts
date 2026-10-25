/** Which GPIOs a binding may use, and for what.
 *
 * Two layers. CHIP_PINS are the chip's rules and mirror firmware/src/pins.cpp,
 * which refuses the same things at boot; release.py fails when the two
 * disagree, so keep this object's shape (one `chip: { usable, adc1,
 * inputOnly }` per chip) that it reads. A board model
 * (firmware/boards.json, published in the manifest) then narrows them to the
 * pins on that board's header and gives them their printed labels. Never
 * strapping, flash, USB or the provisioning-reset button's pin. */
import { BOARDS, type SketchBoard } from "@/lib/firmware-sketch";
import type { BoardModel, PinNeed } from "@/lib/hardware/driver-catalog";

export const CHIP_PINS: Record<SketchBoard, { usable: number[]; adc1: number[]; inputOnly: number[] }> = {
  esp32: {
    usable: [4, 13, 14, 16, 17, 18, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
    adc1: [32, 33, 34, 35, 36, 39],
    inputOnly: [34, 35, 36, 39],
  },
  esp32c3: {
    usable: [0, 1, 3, 4, 5, 6, 7, 10, 20, 21],
    adc1: [0, 1, 3, 4],
    inputOnly: [],
  },
  esp32s3: {
    usable: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47, 48],
    adc1: [1, 2, 4, 5, 6, 7, 8, 9, 10],
    inputOnly: [],
  },
  esp32c6: {
    usable: [0, 1, 2, 3, 6, 7, 10, 11, 14, 18, 19, 20, 21, 22, 23],
    adc1: [0, 1, 2, 3, 6],
    inputOnly: [],
  },
  esp32s2: {
    usable: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 21, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42],
    adc1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    inputOnly: [],
  },
};

/** The model this id names. Configs saved before board models existed hold a
 * chip id ("esp32"); those resolve to the first model of that chip. */
export function resolveModel(models: BoardModel[] | undefined, id: string): BoardModel | undefined {
  return models?.find((m) => m.id === id) ?? models?.find((m) => m.chip === id);
}

/** The pins a role with this need can take on this board. */
export function pinsFor(model: BoardModel, needs: PinNeed): number[] {
  const chip = CHIP_PINS[model.chip];
  const usable = model.pins.filter((p) => chip.usable.includes(p));
  if (needs === "adc1") return usable.filter((p) => chip.adc1.includes(p));
  if (needs === "output" || needs === "bus") return usable.filter((p) => !chip.inputOnly.includes(p));
  return usable;
}

/** The pins to hand out first for a new binding: BOARDS' own pool order, so
 * outputs land on pins that stay quiet at boot (a relay on GPIO 14 would click
 * at power-up) and inputs keep clear of the output pins. Then the rest. */
export function preferredPins(model: BoardModel, needs: PinNeed): number[] {
  const allowed = pinsFor(model, needs);
  const pools = BOARDS[model.chip];
  const pool = needs === "output" || needs === "bus" ? pools.outputs : needs === "input" ? pools.inputs : [];
  return [...pool.filter((p) => allowed.includes(p)), ...allowed.filter((p) => !pool.includes(p))];
}

/** Why a pin can't take this role on this board, or null if it can. */
export function pinProblem(model: BoardModel, needs: PinNeed, pin: number): string | null {
  const chip = CHIP_PINS[model.chip];
  if (!model.pins.includes(pin) || !chip.usable.includes(pin)) return `GPIO ${pin} isn't free on the ${model.label}. Pick another pin.`;
  if (needs === "adc1" && !chip.adc1.includes(pin)) return `GPIO ${pin} can't read analog while Wi-Fi is on. Pick an ADC1 pin.`;
  if ((needs === "output" || needs === "bus") && chip.inputOnly.includes(pin)) return `GPIO ${pin} is input-only. Pick another pin.`;
  return null;
}

export function hasInternalPull(chip: SketchBoard, pin: number): boolean {
  return !CHIP_PINS[chip].inputOnly.includes(pin);
}

/** "GPIO 36 (VP)": the number, plus the board's printed label when it differs. */
export function pinName(model: BoardModel | undefined, pin: number): string {
  const label = model?.pin_labels?.[String(pin)];
  return label ? `GPIO ${pin} (${label})` : `GPIO ${pin}`;
}
