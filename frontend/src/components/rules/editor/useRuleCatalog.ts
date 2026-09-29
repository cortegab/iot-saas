"use client";

import { useCallback, useMemo } from "react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
export type CatalogMetric = components["schemas"]["CatalogMetric"];
export type CatalogActuator = components["schemas"]["CatalogActuator"];

export interface WireOption {
  id: string;
  label: string;
}

/** Devices + their catalog templates, resolved for the rule editors: which
 * metrics/actuators each device exposes, by wire id. */
export interface RuleCatalog {
  devices: DeviceResponse[];
  deviceNameById: Record<string, string>;
  metricOptionsFor: (deviceId: string) => WireOption[];
  actuatorOptionsFor: (deviceId: string) => WireOption[];
  metricFor: (deviceId: string, metric: string) => CatalogMetric | undefined;
  actuatorFor: (deviceId: string, actuator: string) => CatalogActuator | undefined;
}

export function useRuleCatalog(): RuleCatalog {
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: catalogEntries } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const deviceList = useMemo(() => devices ?? [], [devices]);

  const catalogForDevice = useMemo(() => {
    const catalogById = new Map((catalogEntries ?? []).map((c) => [c.id, c]));
    const deviceById = new Map(deviceList.map((d) => [d.id, d]));
    return (id: string): CatalogEntryResponse | undefined => {
      const dev = deviceById.get(id);
      return dev ? catalogById.get(dev.catalog_entry_id) : undefined;
    };
  }, [catalogEntries, deviceList]);

  const metricOptionsFor = useCallback(
    (id: string): WireOption[] =>
      (catalogForDevice(id)?.metrics ?? []).map((m) => ({ id: wireId(m), label: m.name })),
    [catalogForDevice],
  );
  const actuatorOptionsFor = useCallback(
    (id: string): WireOption[] =>
      (catalogForDevice(id)?.actuators ?? []).map((a) => ({ id: wireId(a), label: a.name })),
    [catalogForDevice],
  );
  const metricFor = useCallback(
    (deviceId: string, metric: string) =>
      (catalogForDevice(deviceId)?.metrics ?? []).find((m) => wireId(m) === metric),
    [catalogForDevice],
  );
  const actuatorFor = useCallback(
    (deviceId: string, actuator: string) =>
      (catalogForDevice(deviceId)?.actuators ?? []).find((a) => wireId(a) === actuator),
    [catalogForDevice],
  );
  const deviceNameById = useMemo(
    () => Object.fromEntries(deviceList.map((d) => [d.id, d.name])),
    [deviceList],
  );

  return {
    devices: deviceList,
    deviceNameById,
    metricOptionsFor,
    actuatorOptionsFor,
    metricFor,
    actuatorFor,
  };
}
