/** Which GPIOs a binding may use on each board, and for what. Mirrors
 * firmware/src/pins.cpp, which refuses the same things at boot; keep the two
 * in step. Built on BOARDS' input/output pools (lib/firmware-sketch.ts) plus
 * ADC1 and the ESP32's input-only pins. Never strapping, flash, USB or the
 * provisioning-reset button's pin. */
import { BOARDS, type SketchBoard } from "@/lib/firmware-sketch";
import type { PinNeed } from "@/lib/hardware/driver-catalog";

export const BOARD_PINS: Record<SketchBoard, { usable: number[]; adc1: number[]; inputOnly: number[] }> = {
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
};

/** The pins a role with this need can take on this board. */
export function pinsFor(board: SketchBoard, needs: PinNeed): number[] {
  const b = BOARD_PINS[board];
  if (needs === "adc1") return b.adc1;
  if (needs === "output" || needs === "bus") return b.usable.filter((p) => !b.inputOnly.includes(p));
  return b.usable;
}

/** The pins to hand out first for a new binding: BOARDS' own pool order, so
 * outputs land on pins that stay quiet at boot (a relay on GPIO 14 would click
 * at power-up) and inputs keep clear of the output pins. Then the rest. */
export function preferredPins(board: SketchBoard, needs: PinNeed): number[] {
  const allowed = pinsFor(board, needs);
  const pool = needs === "output" || needs === "bus" ? BOARDS[board].outputs : needs === "input" ? BOARDS[board].inputs : [];
  return [...pool.filter((p) => allowed.includes(p)), ...allowed.filter((p) => !pool.includes(p))];
}

/** Why a pin can't take this role, or null if it can. */
export function pinProblem(board: SketchBoard, needs: PinNeed, pin: number): string | null {
  const b = BOARD_PINS[board];
  if (!b.usable.includes(pin)) return `GPIO ${pin} isn't free on this board. Pick another pin.`;
  if (needs === "adc1" && !b.adc1.includes(pin)) return `GPIO ${pin} can't read analog while Wi-Fi is on. Pick an ADC1 pin.`;
  if ((needs === "output" || needs === "bus") && b.inputOnly.includes(pin)) return `GPIO ${pin} is input-only. Pick another pin.`;
  return null;
}

export function hasInternalPull(board: SketchBoard, pin: number): boolean {
  return !BOARD_PINS[board].inputOnly.includes(pin);
}
