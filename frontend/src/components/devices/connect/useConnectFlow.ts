"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import { forgetCredential, peekCredential } from "@/lib/credential-handoff";
import { BOARDS, buildSketch, defaultPins, pinClashes, provName, type SketchBoard, type SketchCredential } from "@/lib/firmware-sketch";
import { resolveModel } from "@/lib/hardware/board-pins";
import type { FirmwareConfig } from "@/lib/hardware/config-blob";
import { brokerHostProblem, buildFirmwareConfig } from "@/lib/hardware/device-config";
import { hasCapability, useDriverCatalog, type BoardModel, type DriverCatalog } from "@/lib/hardware/driver-catalog";
import { hardwareToDraft, wiringGuide, type KeyedRow, type WiringGuide } from "@/lib/hardware/hardware-draft";
import { useRealtimeEvents } from "@/lib/realtime-bus";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type HardwareConfig = components["schemas"]["HardwareConfig"];

export type CheckState = { ok?: boolean; busy?: boolean; detail?: string };
export interface CheckItem {
  k: string;
  label: string;
  sub: string;
  hint: string;
  /** Set for a command test row. */
  actuator?: CatalogActuator;
}

/** The generic firmware's path: set when the device's wiring (its own, else
 * its template's) names a board model of a published release. This is the one
 * place that decides Install versus the sketch; steps branch on it alone. */
export interface InstallPath {
  wiring: HardwareConfig;
  model: BoardModel;
  firmware: DriverCatalog;
  guide: WiringGuide;
  /** Inputs wired to a pin but feeding no metric: read and thrown away. */
  unlinkedPins: number[];
  /** What Install writes, once the credential, broker and Wi-Fi are set. */
  config: FirmwareConfig | null;
}

export type ConnectFlow = Extract<ReturnType<typeof useConnectFlow>, { kind: "ready" }>["flow"];

/** All of the Connect flow's state and what follows from it (DESIGN.md §8). */
export function useConnectFlow(deviceId: string) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { memberships, currentTenantId } = useAuth();
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug ?? "";
  const { data: device, error } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const { data: firmware } = useDriverCatalog();

  const [step, setStep] = useState(1);
  const [credential, setCredential] = useState<SketchCredential | null>(() => peekCredential(deviceId));
  const [stored, setStored] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [board, setBoard] = useState<SketchBoard>("esp32");
  const [wifiMode, setWifiMode] = useState<"ble" | "sketch">("ble");
  const [ssid, setSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [tls, setTls] = useState(() => typeof window !== "undefined" && window.location.protocol === "https:");
  const [pinOverrides, setPinOverrides] = useState<Record<string, number>>({});
  const [live, setLive] = useState<Record<string, CheckState>>({});
  // The broker the board connects to. Defaults to this page's host, which is
  // right in production; on a dev machine it's localhost, which a board can't reach.
  const [host, setHost] = useState(() => (typeof window !== "undefined" ? window.location.hostname : ""));

  const metrics = useMemo<CatalogMetric[]>(() => template?.metrics ?? [], [template]);
  const actuators = useMemo<CatalogActuator[]>(() => template?.actuators ?? [], [template]);
  const wiring = device?.hardware ?? template?.hardware ?? null;
  const model = wiring ? resolveModel(firmware?.models, wiring.board) : undefined;
  const installable = wiring != null && model != null && firmware != null;
  const sketchBoard: SketchBoard = installable ? model.chip : board;
  // Phone setup needs Bluetooth; a board without it (the S2) only takes Wi-Fi typed in.
  const phoneSetup = installable ? hasCapability(model, "ble") : BOARDS[sketchBoard].ble;
  const pins = useMemo(() => ({ ...defaultPins(metrics, actuators, sketchBoard), ...pinOverrides }), [metrics, actuators, sketchBoard, pinOverrides]);

  // The live check: status, first reading per metric, command acks.
  useRealtimeEvents((m) => {
    if (m.device_id !== deviceId) return;
    if (m.type === "device_health" && m.online) {
      setLive((l) => ({ ...l, status: { ok: true, detail: [m.rssi != null && `rssi ${m.rssi} dBm`, m.fw_version && `fw ${m.fw_version}`].filter(Boolean).join(" · ") || "online" } }));
    } else if (m.type === "telemetry" && m.metric) {
      setLive((l) => ({ ...l, status: l.status?.ok ? l.status : { ok: true, detail: "publishing" }, [`m:${m.metric}`]: { ok: true, detail: String(m.value) } }));
    } else if (m.type === "command_ack") {
      setLive((l) => {
        const waiting = Object.entries(l).find(([k, s]) => k.startsWith("a:") && s.busy);
        return waiting ? { ...l, [waiting[0]]: { ok: true, detail: "acknowledged" } } : l;
      });
    }
  });

  if (error) return { kind: "error" as const, error };
  if (!device || !template) return { kind: "loading" as const };

  const clashes = pinClashes(pins);
  const blocked = !installable && Object.keys(clashes).length > 0;
  const hostProblem = brokerHostProblem(host);
  const phone = phoneSetup && wifiMode === "ble";
  // Phone setup uses provisioning Security 1 (PoP = the device's password).
  // Security 2 (SRP6a) is off until the firmware's network_provisioning is
  // >= 1.0.5: on 1.0.2 the app's Wi-Fi list stays empty (docs/ble-provisioning.md).
  const security = 1 as const;
  const neverConnected = device.connection_state === "never_connected";
  const wifi = phone ? undefined : { ssid, password: wifiPassword };

  // The wiring as rows keyed by wire id, for the guide and the live check's hints.
  const keyedRows: { metrics: KeyedRow[]; actuators: KeyedRow[] } = {
    metrics: metrics.map((m) => ({ uid: wireId(m), key: wireId(m), name: m.name, type: m.data_type ?? "float" })),
    actuators: actuators.map((a) => ({ uid: wireId(a), key: wireId(a), name: a.name, type: a.value_type ?? "bool" })),
  };
  const install: InstallPath | null = installable
    ? {
        wiring,
        model,
        firmware,
        guide: wiringGuide(hardwareToDraft(wiring, keyedRows)!, keyedRows, firmware),
        unlinkedPins: (wiring.inputs ?? []).filter((b) => !Object.values(b.channels ?? {}).some(Boolean)).flatMap((b) => Object.values(b.pins ?? {})),
        config:
          credential && !hostProblem && (phone || ssid)
            ? buildFirmwareConfig({ tenantSlug, device, metrics, actuators, wiring, model, host: host.trim(), tls, credential, wifi, provisioning: { security } })
            : null,
      }
    : null;

  /** The GPIO a metric or actuator is wired to, for "Not showing up?" hints. */
  const wiredPin = (key: string): number | undefined => {
    if (!install) return pins[key];
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    const binding = (kind === "m" ? install.wiring.inputs : install.wiring.outputs)?.find((b) => Object.values(b.channels ?? {}).includes(id));
    return binding ? Object.values(binding.pins ?? {})[0] : undefined;
  };

  // With the generic firmware, only what's wired publishes or answers, so the
  // live check waits for just those.
  const checkedMetrics = install ? metrics.filter((m) => wiredPin(`m:${wireId(m)}`) != null) : metrics;
  const boolActuators = actuators.filter((a) => (a.value_type ?? "bool") === "bool" && (!install || wiredPin(`a:${wireId(a)}`) != null));
  const items: CheckItem[] = [
    {
      k: "status",
      label: "Reached the broker",
      sub: `${tenantSlug}/${device.slug}/status`,
      hint: install
        ? `Check the board is on a 2.4 GHz network that can reach ${host}. Its LED double-blinks while it can't connect.`
        : "Check the board is powered and on a 2.4 GHz network, and that the whole credential was pasted.",
    },
    ...checkedMetrics.map((m) => ({
      k: `m:${wireId(m)}`,
      label: `First reading: ${m.name}`,
      sub: `…/${wireId(m)}`,
      hint:
        install || m.data_type === "bool"
          ? `Check the wiring on GPIO ${wiredPin(`m:${wireId(m)}`)}.`
          : "The sketch publishes nothing until your sensor code returns a number.",
    })),
    ...boolActuators.map((a) => ({
      k: `a:${wireId(a)}`,
      label: `Command test: ${a.name}`,
      sub: `…/cmd/${wireId(a)} → ack`,
      hint: `Nothing on GPIO ${wiredPin(`a:${wireId(a)}`)}? Check the relay's supply and whether it's active-low.`,
      actuator: a,
    })),
  ];

  const sketchFor = (cred: SketchCredential | null) =>
    buildSketch({
      tenantSlug,
      deviceSlug: device.slug,
      deviceName: device.name,
      board: sketchBoard,
      host,
      tls,
      metrics,
      actuators,
      credential: cred,
      wifi,
      provisioning: phone ? { security } : undefined,
      pins,
    });

  async function rotate() {
    if (!neverConnected) {
      const ok = await confirm("The firmware running now disconnects until the new sketch is flashed. The provisioning QR changes too.", {
        title: `Rotate the credential for ${device!.name}?`,
        confirmLabel: "Rotate credential",
      });
      if (!ok) return;
    }
    setRotating(true);
    try {
      const result = await api.post<DeviceCreateResponse>(`/devices/${deviceId}/rotate-credential`);
      setCredential(result.credential);
      setStored(false);
      toast({ title: "Credential ready", detail: "Store it, then choose the firmware options." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't rotate the credential", detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setRotating(false);
    }
  }

  async function sendTest(actuator: CatalogActuator) {
    const key = `a:${wireId(actuator)}`;
    setLive((l) => ({ ...l, [key]: { busy: true } }));
    try {
      await api.post(`/devices/${deviceId}/commands`, { actuator: wireId(actuator), value: actuator.on_value ?? true });
    } catch (err) {
      setLive((l) => ({ ...l, [key]: {} }));
      toast({ tone: "error", title: "Couldn't send the test", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  function leave(href: string) {
    forgetCredential(deviceId);
    router.push(href);
  }

  function changeBoard(next: SketchBoard) {
    setBoard(next);
    setPinOverrides({}); // the other board has different GPIOs
  }

  return {
    kind: "ready" as const,
    flow: {
      deviceId,
      device,
      template,
      tenantSlug,
      metrics,
      actuators,
      wiring,
      firmwarePublished: firmware != null,
      install,
      sketchBoard,
      boardInfo: BOARDS[sketchBoard],
      name: provName(device.name),
      security,
      neverConnected,
      // Wiring is edited for this device alone (its Settings tab) or for every
      // device that follows the template.
      deviceWiringHref: `/devices/${device.id}?tab=settings#hardware`,
      templateWiringHref: `/templates/${template.id}#hardware`,
      step,
      setStep,
      credential,
      stored,
      setStored,
      rotating,
      rotate,
      board,
      changeBoard,
      wifiMode,
      setWifiMode,
      phoneSetup,
      phone,
      ssid,
      setSsid,
      wifiPassword,
      setWifiPassword,
      tls,
      setTls,
      host,
      setHost,
      hostProblem,
      pins,
      setPinOverrides,
      clashes,
      blocked,
      checkedMetrics,
      boolActuators,
      items,
      live,
      allLive: items.every((it) => live[it.k]?.ok),
      sendTest,
      sketchFor,
      leave,
      toast,
      confirmDialog: dialog,
    },
  };
}
