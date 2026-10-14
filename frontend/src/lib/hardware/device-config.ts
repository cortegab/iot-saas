/** A device's config for the generic firmware (firmware/), built from its
 * template and wiring: what the Connect flow's Install writes into the board's
 * `cfg` partition (lib/hardware/config-blob.ts). The firmware-side twin of
 * buildSketch (lib/firmware-sketch.ts): same broker, topics, provisioning
 * name and credential. Pure, so it's unit-tested. */
import { provName, type SketchCredential } from "@/lib/firmware-sketch";
import type { FirmwareConfig } from "@/lib/hardware/config-blob";
import type { BoardModel } from "@/lib/hardware/driver-catalog";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type HardwareConfig = components["schemas"]["HardwareConfig"];

export interface DeviceConfigInput {
  tenantSlug: string;
  device: { slug: string; name: string };
  metrics: CatalogMetric[];
  actuators: CatalogActuator[];
  /** The device's own wiring, else its template's (device.hardware ?? template.hardware). */
  wiring: HardwareConfig;
  model: BoardModel;
  host: string;
  tls: boolean;
  credential: SketchCredential;
  /** Typed-in Wi-Fi (bench test); omitted = provision from the phone. */
  wifi?: { ssid: string; password: string };
  /** Phone provisioning; Security 2 needs the SRP6a salt and verifier (lib/srp6a.ts). */
  provisioning: { security: 1 } | { security: 2; salt: Uint8Array; verifier: Uint8Array };
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

export function buildFirmwareConfig(input: DeviceConfigInput): FirmwareConfig {
  const { provisioning: p } = input;
  return {
    v: 1,
    board: input.model.chip,
    model: input.model.id,
    device: { tenant: input.tenantSlug, device: input.device.slug },
    mqtt: {
      host: input.host,
      port: input.tls ? 8883 : 1883,
      tls: input.tls,
      username: input.credential.username,
      password: input.credential.password,
    },
    prov: {
      name: provName(input.device.name),
      security: p.security,
      ...(p.security === 2 ? { salt: base64(p.salt), verifier: base64(p.verifier) } : {}),
    },
    ...(input.wifi ? { wifi: input.wifi } : {}),
    ...(input.wiring.i2c ? { i2c: input.wiring.i2c } : {}),
    metrics: input.metrics.map((m) => ({
      key: wireId(m),
      ...(m.data_type === "bool" ? { bool: true } : {}),
      publish: m.publish ?? "periodic",
      ...(m.publish_interval_seconds ? { interval_s: m.publish_interval_seconds } : {}),
      ...(m.publish_deadband != null ? { deadband: m.publish_deadband } : {}),
    })),
    actuators: input.actuators.map((a) => ({ key: wireId(a), type: a.value_type ?? "bool" })),
    inputs: (input.wiring.inputs ?? []).map((b) => ({ driver: b.driver, pins: b.pins ?? {}, params: b.params ?? {}, channels: b.channels ?? {} })),
    outputs: (input.wiring.outputs ?? []).map((b) => ({ driver: b.driver, pins: b.pins ?? {}, params: b.params ?? {}, channels: b.channels ?? {} })),
  };
}

/** Why the board can't reach this broker host, or null. A board can't reach
 * the dashboard's own "localhost": that's the computer it runs on, not the board. */
export function brokerHostProblem(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) return "Enter the broker's address.";
  if (h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127."))
    return "The board can't reach localhost. Enter this computer's address on your network, e.g. 192.168.1.82.";
  return null;
}
