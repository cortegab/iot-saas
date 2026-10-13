/** The driver catalog: what the generic firmware can read and drive, with the
 * pins, params and channels each driver takes. Its source is
 * firmware/drivers.json, published inside each release's manifest.json, so
 * the editor only offers what the firmware being flashed supports. */
import useSWR from "swr";
import { BOARDS, type SketchBoard } from "@/lib/firmware-sketch";
import { CHIP_PINS } from "@/lib/hardware/board-pins";
import { loadManifest, type FirmwareManifest } from "@/lib/hardware/flasher";

/** What a pin role needs: any input-capable GPIO, an output-capable one, an
 * ADC1 pin (analog while Wi-Fi is on), or a bus line (input and output). */
export type PinNeed = "input" | "output" | "adc1" | "bus";

export interface DriverPinSpec {
  role: string;
  label: string;
  needs: PinNeed;
}

export interface DriverParamSpec {
  key: string;
  label: string;
  type: "int" | "float" | "bool" | "enum";
  default: number | boolean | string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface DriverChannelSpec {
  key: string;
  label: string;
  /** Inputs: the kind of reading. */
  data_type?: "float" | "bool";
  /** Outputs: the kind of command value it takes. */
  value_type?: "bool" | "float" | "string";
}

export interface DriverSpec {
  id: string;
  kind: "input" | "output";
  label: string;
  description: string;
  pins: DriverPinSpec[];
  params: DriverParamSpec[];
  channels: DriverChannelSpec[];
  wiring: string[];
}

export interface DriverCatalog {
  version: string;
  drivers: DriverSpec[];
  models: BoardModel[];
}

/** A board people buy and wire (firmware/boards.json): which chip's build it
 * runs, the GPIOs on its header, and their printed labels. Several models can
 * share a chip (the 30- and 38-pin ESP32 DevKits). */
export interface BoardModel {
  id: string;
  chip: SketchBoard;
  label: string;
  description: string;
  pins: number[];
  pin_labels?: Record<string, string>;
  reset: { pin: number; label: string };
  led: { pin: number; active_low: boolean };
  notes?: string[];
}

/** A release's board models. One published before models existed gets one
 * per chip, id = chip id, offering every pin the firmware accepts. */
export function boardModels(manifest: Pick<FirmwareManifest, "boards" | "models">): BoardModel[] {
  return manifest.models ?? legacyModels(Object.keys(manifest.boards));
}

function legacyModels(chips: string[]): BoardModel[] {
  return chips
    .filter((c): c is SketchBoard => c in CHIP_PINS)
    .map((chip) => ({
      id: chip,
      chip,
      label: BOARDS[chip].label,
      description: "",
      pins: CHIP_PINS[chip].usable,
      reset: { pin: BOARDS[chip].resetPin, label: BOARDS[chip].resetButton },
      led: { pin: chip === "esp32c3" ? 8 : 2, active_low: chip === "esp32c3" },
    }));
}

/** The latest published release's catalog. `error` when none is published. */
export function useDriverCatalog() {
  return useSWR<DriverCatalog>(
    "firmware:latest-drivers",
    async () => {
      const manifest = await loadManifest();
      return {
        version: manifest.version,
        drivers: manifest.drivers,
        models: boardModels(manifest),
      };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
}

export function findDriver(drivers: DriverSpec[] | undefined, id: string): DriverSpec | undefined {
  return drivers?.find((d) => d.id === id);
}
