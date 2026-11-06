/** Live updates for the signed-in app, as on the web (frontend
 * hooks/useRealtime.ts): one WebSocket per workspace while the app is in the
 * foreground (closed in the background, to spare the battery), readings
 * applied to the cached latest values and device status in batches, and
 * new points handed to the charts that asked for them. */
import type { components } from "@iodriven/shared/api";
import { applyDeviceHealth, markOnline, mergeLatest } from "@iodriven/shared/live-telemetry";
import { connectRealtime, type RealtimeMessage, type RealtimeStatus, type SocketLike } from "@iodriven/shared/realtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useSWRConfig } from "swr";
import { isNotificationsKey } from "@/alerts/notifications";
import { useAuth } from "@/auth/AuthProvider";
import { apiUrl } from "@/lib/config";

type DeviceResponse = components["schemas"]["DeviceResponse"];

export interface LivePoint {
  /** Epoch seconds. */
  t: number;
  v: number;
}
type Listener = (points: LivePoint[]) => void;

interface RealtimeContextValue {
  status: RealtimeStatus;
  /** New readings of one device's metric, delivered in batches. */
  subscribe: (deviceId: string, metric: string, listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({ status: "closed", subscribe: () => () => undefined });

const FLUSH_MS = 500;
const iso = (t: number) => new Date(t * 1000).toISOString();

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { accessToken, currentTenantId, refresh } = useAuth();
  const { mutate, cache } = useSWRConfig();
  const [status, setStatus] = useState<RealtimeStatus>("closed");
  const [active, setActive] = useState(AppState.currentState === "active");

  // The socket reads the latest token when it (re)connects; a refreshed token
  // mustn't tear the connection down.
  const tokenRef = useRef(accessToken);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    tokenRef.current = accessToken;
    refreshRef.current = refresh;
  }, [accessToken, refresh]);

  const listeners = useRef(new Map<string, Set<Listener>>());
  const pending = useRef(new Map<string, { deviceId: string; metric: string; points: LivePoint[] }>());

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setActive(next === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active || !currentTenantId) return;
    const queue = pending.current;
    const cached = (key: string) => cache.get(key)?.data !== undefined;
    const patchDevice = (deviceId: string, update: (d: DeviceResponse | undefined) => DeviceResponse | undefined) => {
      const key = `/devices/${deviceId}`;
      if (cached(key)) void mutate<DeviceResponse>(key, update, { revalidate: false });
      if (cached("/devices")) {
        void mutate<DeviceResponse[]>("/devices", (list) => list?.map((d) => (d.id === deviceId ? (update(d) ?? d) : d)), { revalidate: false });
      }
    };

    const flush = setInterval(() => {
      if (pending.current.size === 0) return;
      const batch = [...pending.current.values()];
      pending.current.clear();
      const newestByDevice = new Map<string, number>();
      for (const { deviceId, metric, points } of batch) {
        listeners.current.get(`${deviceId}|${metric}`)?.forEach((l) => l(points));
        const last = points.reduce((a, b) => (b.t > a.t ? b : a));
        const latestKey = `/devices/${deviceId}/latest`;
        if (cached(latestKey)) void mutate(latestKey, mergeLatest(metric, last.v, iso(last.t)), { revalidate: false });
        newestByDevice.set(deviceId, Math.max(newestByDevice.get(deviceId) ?? 0, last.t));
      }
      for (const [deviceId, t] of newestByDevice) patchDevice(deviceId, markOnline(iso(t)));
    }, FLUSH_MS);

    function onMessage(m: RealtimeMessage) {
      if (m.type === "telemetry" && m.device_id && m.metric != null && typeof m.value === "number") {
        const key = `${m.device_id}|${m.metric}`;
        const entry = pending.current.get(key) ?? { deviceId: m.device_id, metric: m.metric, points: [] };
        entry.points.push({ t: m.time ?? Date.now() / 1000, v: m.value });
        pending.current.set(key, entry);
      } else if (m.type === "notification") {
        // A new alert: the list, its pages and the tab badge fetch again.
        void mutate(isNotificationsKey);
        void mutate("/tenants/current/attention");
      } else if (m.type === "command_ack" && m.device_id) {
        // No payload worth applying: fetch the device's commands again.
        const key = `/devices/${m.device_id}/commands`;
        if (cached(key)) void mutate(key);
      } else if (m.type === "device_health" && m.device_id && typeof m.online === "boolean") {
        patchDevice(
          m.device_id,
          applyDeviceHealth({
            online: m.online,
            rssi: m.rssi ?? null,
            battery_pct: m.battery_pct ?? null,
            uptime_s: m.uptime_s ?? null,
            fw_version: m.fw_version ?? null,
          }),
        );
      }
    }

    const connection = connectRealtime({
      getToken: async (reason) => (reason === "auth-rejected" ? ((await refreshRef.current())?.access_token ?? null) : tokenRef.current),
      tenantId: currentTenantId,
      apiUrl: apiUrl(),
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      onMessage,
      onStatusChange: setStatus,
    });
    return () => {
      connection.close();
      clearInterval(flush);
      queue.clear();
      setStatus("closed");
    };
  }, [active, currentTenantId, mutate, cache]);

  const subscribe = useCallback((deviceId: string, metric: string, listener: Listener) => {
    const key = `${deviceId}|${metric}`;
    const set = listeners.current.get(key) ?? new Set<Listener>();
    set.add(listener);
    listeners.current.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.current.delete(key);
    };
  }, []);

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
