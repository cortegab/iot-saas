"use client";

import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { useAuth } from "@/hooks/useAuth";
import { connectRealtime, type RealtimeMessage, type RealtimeStatus } from "@/lib/realtime";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Mounted once (frontend/src/app/(app)/layout.tsx), not per-component. Its
 * only job is telling SWR "something changed for device X" — the REST
 * endpoints stay the single source of truth for what that data actually is,
 * so every existing useApiSWR('/devices/{id}/...') call site benefits from
 * this without being touched, simply by sharing the same cache key.
 */
export function useRealtime(): RealtimeStatus {
  const { accessToken, currentTenantId, refresh } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

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
      if (message.type === "telemetry" && message.device_id) {
        const deviceId = message.device_id;
        const metricPrefix = `/devices/${deviceId}/data?metric=${encodeURIComponent(message.metric ?? "")}`;
        void mutate(
          (key) =>
            typeof key === "string" &&
            (key === `/devices/${deviceId}/latest` ||
              // A telemetry message is also the only signal a device just
              // came online (connection_state is derived from last_seen_at
              // server-side) — revalidate the plain device endpoint too, so
              // every ConnectionBadge reading it updates live.
              key === `/devices/${deviceId}` ||
              key.startsWith(metricPrefix)),
        );
      } else if (message.type === "command_ack" && message.device_id) {
        void mutate(`/devices/${message.device_id}/commands`);
      } else if (message.type === "notification") {
        void mutate("/notifications");
      }
    }

    const connection = connectRealtime({
      getToken,
      tenantId: currentTenantId,
      apiUrl: API_URL,
      onMessage,
      onStatusChange: setStatus,
    });

    return () => connection.close();
  }, [currentTenantId, refresh]);

  return status;
}
