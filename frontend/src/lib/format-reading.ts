import type { components } from "@/types/api";

type CatalogMetric = components["schemas"]["CatalogMetric"];

/** True for an on/off metric (data_type "bool", stored as 0/1). */
export function isBoolMetric(meta?: Pick<CatalogMetric, "data_type"> | null): boolean {
  return meta?.data_type === "bool";
}

/** One reading as every surface shows it — device readouts, the device peek,
 * dashboard cards and chart legends: "On"/"Off" for an on/off metric, the
 * template's decimals otherwise. The unit is separate (it's set smaller). */
export function formatReading(value: number, meta?: Pick<CatalogMetric, "data_type" | "decimals"> | null): string {
  if (isBoolMetric(meta)) return value ? "On" : "Off";
  if (meta?.decimals != null && Number.isFinite(value)) return value.toFixed(meta.decimals);
  return String(value);
}
