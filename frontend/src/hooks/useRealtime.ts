"use client";

import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { useAuth } from "@/hooks/useAuth";
import { connectRealtime, type RealtimeMessage, type RealtimeStatus } from "@/lib/realtime";
import { appendPoint, markOnline, mergeLatest } from "@/lib/live-telemetry";
import type { components } from "@/types/api";

type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type TelemetryDataResponse = components["schemas"]["TelemetryDataResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Mounted once (frontend/src/app/(app)/layout.tsx), not per-component.
 *
 * For a telemetry frame it **applies** the pushed `{metric, value, time}`
 * straight into the relevant SWR caches (`revalidate: false`) rather than
 * invalidating and re-fetching — the frame already carries everything the
 * live surfaces need, and a refetch would only race the ~1s DB batch flush
 * and return the previous sample. The existing `refreshInterval` / on-focus
 * refetch on those keys stays as the reconciling backstop, and a WS
 * reconnect triggers one real revalidation to catch up on missed frames.
 *
 * `command_ack` / `notification` still just invalidate — no useful payload
 * to apply.
 */
export function useRealtime(): RealtimeStatus {
  const { accessToken, currentTenantId, refresh } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
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

    function onMessage(message: RealtimeMessage) {
      if (
        message.type === "telemetry" &&
        message.device_id &&
        message.metric != null &&
        typeof message.value === "number"
      ) {
        const deviceId = message.device_id;
        const metric = message.metric;
        const value = message.value;
        const seconds = message.time ?? Math.floor(Date.now() / 1000);
        const iso = new Date(seconds * 1000).toISOString();
        const dataPrefix = `/devices/${deviceId}/data?metric=${encodeURIComponent(metric)}`;

        void mutate<TelemetryLatestResponse[]>(
          `/devices/${deviceId}/latest`,
          mergeLatest(metric, value, iso),
          { revalidate: false },
        );
        void mutate<DeviceResponse>(`/devices/${deviceId}`, markOnline(iso), { revalidate: false });
        void mutate<TelemetryDataResponse>(
          (key) => typeof key === "string" && key.startsWith(dataPrefix),
          appendPoint(iso, value),
          { revalidate: false },
        );
      } else if (message.type === "command_ack" && message.device_id) {
        void mutate(`/devices/${message.device_id}/commands`);
      } else if (message.type === "notification") {
        void mutate("/notifications");
      }
    }

    function onStatusChange(next: RealtimeStatus) {
      setStatus(next);
      if (next === "reconnecting") droppedRef.current = true;
      if (next === "open" && droppedRef.current) {
        droppedRef.current = false;
        // Frames that arrived while the socket was down were missed — do one
        // real revalidation of every device-scoped key to catch up.
        void mutate((key) => typeof key === "string" && key.startsWith("/devices/"), undefined, {
          revalidate: true,
        });
      }
    }

    const connection = connectRealtime({
      getToken,
      tenantId: currentTenantId,
      apiUrl: API_URL,
      onMessage,
      onStatusChange,
    });

    return () => connection.close();
  }, [currentTenantId, refresh]);

  return status;
}
