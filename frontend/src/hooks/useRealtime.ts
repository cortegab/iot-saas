"use client";

import { useEffect, useRef, useState } from "react";
import { mutate, useSWRConfig } from "swr";
import { useAuth } from "@/hooks/useAuth";
import { connectRealtime, type RealtimeMessage, type RealtimeStatus } from "@/lib/realtime";
import { emitRealtime } from "@/lib/realtime-bus";
import { liveBuffer, type LatestBatch } from "@/lib/live-buffer";
import { applyDeviceHealth, markOnline, mergeLatest } from "@/lib/live-telemetry";
import type { components } from "@/types/api";

type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** A history feed and every page of it the screen has loaded (`${path}?limit=…`,
 * components/list/useServerPager.ts). */
/** The attention strip's counts (components/dashboards/AttentionStrip). */
const ATTENTION_KEY = "/tenants/current/attention";

function revalidateFeed(path: string): void {
  void mutate((key) => typeof key === "string" && (key === path || key.startsWith(`${path}?`)));
}

/** One real revalidation of every device-scoped key — after a WS reconnect
 * (frames were missed) or when the page is visible again (lib/live-buffer
 * drops frames while hidden). */
function catchUpDevices(): void {
  void mutate((key) => typeof key === "string" && key.startsWith("/devices/"), undefined, {
    revalidate: true,
  });
}

/** Mounted once (frontend/src/app/(app)/layout.tsx), not per-component.
 *
 * Telemetry frames go into lib/live-buffer, not straight into SWR: a device
 * publishing 20×/s would otherwise re-render every subscriber 20×/s. Each
 * buffer flush (at most 4×/s) **applies** the newest `{metric, value, time}`
 * per device into its SWR caches (`revalidate: false`) rather than
 * invalidating and re-fetching — the frame already carries everything the
 * live surfaces need, and a refetch would only race the ~1s DB batch flush
 * and return the previous sample. Trend charts read their points from the
 * buffer directly (TrendChart.tsx). The existing `refreshInterval` /
 * on-focus refetch on those keys stays as the reconciling backstop, and a WS
 * reconnect triggers one real revalidation to catch up on missed frames.
 *
 * It only writes keys that are *already cached with data* — writing into a
 * key that has no cached value (a page not open, or a request in flight)
 * would bump SWR's version counter and make it discard the in-flight fetch's
 * result, leaving that key empty until the next trigger.
 *
 * `command_ack` / `notification` still just invalidate — no useful payload
 * to apply.
 */
export function useRealtime(): RealtimeStatus {
  const { accessToken, currentTenantId, refresh } = useAuth();
  const { cache } = useSWRConfig();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const droppedRef = useRef(false);

  useEffect(() => {
    if (!currentTenantId) return;

    async function getToken(reason: "initial" | "auth-rejected" | "reconnect"): Promise<string | null> {
      if (reason !== "auth-rejected") return tokenRef.current;
      // The previous token was rejected (expired access tokens are the
      // common case, given how short-lived they are) — rotate it, mirroring
      // useApi.ts's own retry-on-401 pattern for regular HTTP calls.
      const refreshed = await refresh();
      return refreshed?.access_token ?? null;
    }

    function hasData(key: string): boolean {
      return cacheRef.current.get(key)?.data != null;
    }

    /** One flush's worth of readings: a single mutate per device and key,
     * however many frames arrived since the last one. */
    function applyLatest(batch: LatestBatch) {
      const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
      for (const [deviceId, readings] of batch) {
        const latestKey = `/devices/${deviceId}/latest`;
        if (hasData(latestKey)) {
          void mutate<TelemetryLatestResponse[]>(
            latestKey,
            (current) => readings.reduce((acc, r) => mergeLatest(r.metric, r.value, iso(r.t))(acc), current),
            { revalidate: false },
          );
        }

        const deviceKey = `/devices/${deviceId}`;
        if (hasData(deviceKey)) {
          const newest = Math.max(...readings.map((r) => r.t));
          void mutate<DeviceResponse>(deviceKey, markOnline(iso(newest)), { revalidate: false });
        }
      }
    }

    function onMessage(message: RealtimeMessage) {
      emitRealtime(message);
      if (
        message.type === "telemetry" &&
        message.device_id &&
        message.metric != null &&
        typeof message.value === "number"
      ) {
        liveBuffer.push(message.device_id, message.metric, message.value, message.time ?? Date.now() / 1000);
      } else if (
        message.type === "device_health" &&
        message.device_id &&
        typeof message.online === "boolean"
      ) {
        const deviceKey = `/devices/${message.device_id}`;
        void mutate(ATTENTION_KEY);
        if (hasData(deviceKey)) {
          void mutate<DeviceResponse>(
            deviceKey,
            applyDeviceHealth({
              online: message.online,
              rssi: message.rssi ?? null,
              battery_pct: message.battery_pct ?? null,
              uptime_s: message.uptime_s ?? null,
              fw_version: message.fw_version ?? null,
            }),
            { revalidate: false },
          );
        }
      } else if (message.type === "command_ack" && message.device_id) {
        revalidateFeed(`/devices/${message.device_id}/commands`);
      } else if (message.type === "notification") {
        revalidateFeed("/notifications");
        void mutate(ATTENTION_KEY);
      } else if (message.type === "rule_execution" && message.rule_id) {
        revalidateFeed(`/rules/${message.rule_id}/executions`);
        void mutate("/rules/activity");
      } else if ((message.type === "rule_health" || message.type === "rule_latched") && message.rule_id) {
        void mutate("/rules");
        void mutate(`/rules/${message.rule_id}`);
        void mutate(ATTENTION_KEY);
      }
    }

    function onStatusChange(next: RealtimeStatus) {
      setStatus(next);
      if (next === "reconnecting") droppedRef.current = true;
      if (next === "open" && droppedRef.current) {
        droppedRef.current = false;
        // Frames that arrived while the socket was down were missed.
        catchUpDevices();
      }
    }

    function onVisibilityChange() {
      if (document.hidden) liveBuffer.clear();
      else catchUpDevices();
    }

    liveBuffer.setLatestHandler(applyLatest);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const connection = connectRealtime({
      getToken,
      tenantId: currentTenantId,
      apiUrl: API_URL,
      onMessage,
      onStatusChange,
    });

    return () => {
      connection.close();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      liveBuffer.setLatestHandler(null);
    };
  }, [currentTenantId, refresh]);

  return status;
}
