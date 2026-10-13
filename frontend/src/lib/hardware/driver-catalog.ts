/** The driver catalog: what the generic firmware can read and drive, with the
 * pins, params and channels each driver takes. Its source is
 * firmware/drivers.json, published inside each release's manifest.json, so
 * the editor only offers what the firmware being flashed supports. */
import useSWR from "swr";
import { loadManifest } from "@/lib/hardware/flasher";

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
}

/** The latest published release's catalog. `error` when none is published. */
export function useDriverCatalog() {
  return useSWR<DriverCatalog>(
    "firmware:latest-drivers",
    async () => {
      const manifest = await loadManifest();
      return { version: manifest.version, drivers: manifest.drivers };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
}

export function findDriver(drivers: DriverSpec[] | undefined, id: string): DriverSpec | undefined {
  return drivers?.find((d) => d.id === id);
}
