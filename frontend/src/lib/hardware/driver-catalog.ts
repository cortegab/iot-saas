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
  /** false: an uncommon reading (a motion sensor's raw axes). Adding the part
   * doesn't make a metric for it until it's kept. Absent = common. */
  common?: boolean;
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
  /** Set for drivers on the shared I2C bus: they take no pins of their own
   * (the template's I2C bus row sets SDA/SCL) but an `address` param. */
  bus?: "i2c";
  /** The I2C addresses this part can be set to. */
  addresses?: string[];
  /** The chips whose firmware build carries this driver; absent = every chip. */
  chips?: SketchBoard[];
}

/** Whether this board's firmware build carries the driver. */
export function runsOn(spec: Pick<DriverSpec, "chips">, model: Pick<BoardModel, "chip"> | undefined): boolean {
  return !model || !spec.chips || spec.chips.includes(model.chip);
}

/** The drivers this board's firmware build carries (all of them while no board resolves). */
export function driversFor(drivers: DriverSpec[], model: Pick<BoardModel, "chip"> | undefined): DriverSpec[] {
  return drivers.filter((d) => runsOn(d, model));
}

export interface DriverCatalog {
  version: string;
  drivers: DriverSpec[];
  models: BoardModel[];
  /** The whole release, for flashing it. */
  manifest: FirmwareManifest;
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
  /** Where the I2C bus goes by default on this board. */
  i2c?: { sda: number; scl: number };
  reset: { pin: number; label: string };
  /** The status LED the firmware keeps for itself. `type` is absent in
   * releases before 0.6.0, which only had plain GPIO LEDs. */
  led: { type?: "gpio" | "rgb" | "none"; pin: number; active_low: boolean };
  /** What the board can do; absent in releases before 0.6.0. */
  capabilities?: BoardCapability[];
  notes?: string[];
}

/** `ble`: Wi-Fi can be set up from a phone. `rgb_led`: its status LED is RGB. */
export type BoardCapability = "ble" | "rgb_led";

/** Whether a board can do something. Releases from before capabilities only
 * had ESP32 and C3 boards, which all have BLE. */
export function hasCapability(model: Pick<BoardModel, "capabilities">, capability: BoardCapability): boolean {
  return (model.capabilities ?? ["ble"]).includes(capability);
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
      led: { type: "gpio" as const, pin: chip === "esp32c3" ? 8 : 2, active_low: chip === "esp32c3" },
      capabilities: ["ble" as const],
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
        manifest,
      };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
}

export function findDriver(drivers: DriverSpec[] | undefined, id: string): DriverSpec | undefined {
  return drivers?.find((d) => d.id === id);
}
