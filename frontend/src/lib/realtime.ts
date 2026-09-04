"use client";

export type RealtimeStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface RealtimeMessage {
  type: string;
  device_id?: string;
  metric?: string;
  value?: number;
  time?: number;
  command_id?: string;
  // device_health frame fields (a retained {tenant}/{device}/status message
  // relayed live, CLAUDE.md §4).
  online?: boolean;
  rssi?: number | null;
  battery_pct?: number | null;
  uptime_s?: number | null;
  fw_version?: string | null;
  // rule_execution: a rule fired — "just invalidate" like command_ack/
  // notification, not a payload to apply (the row is server-derived state).
  rule_id?: string;
}

const MAX_BACKOFF_MS = 15_000;

export function wsUrlFromApiUrl(apiUrl: string, token: string, tenantId: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = `?token=${encodeURIComponent(token)}&tenant_id=${encodeURIComponent(tenantId)}`;
  return url.toString();
}

/** Fire-and-forget WS connection manager: reconnects with backoff on a
 * network-ish drop, and — since access tokens are short-lived — asks for a
 * freshly-refreshed token specifically when the server closed the
 * connection because the token itself was rejected (4401). A 4403 ("valid
 * token, wrong tenant") is treated as permanent: retrying can't fix it,
 * only picking a different tenant (which remounts this connection anyway).
 */
export function connectRealtime(options: {
  /** `reason` tells the caller why a token is being requested, so it only
   * pays for a refresh call when the previous token was actually rejected. */
  getToken: (reason: "initial" | "auth-rejected" | "reconnect") => Promise<string | null>;
  tenantId: string;
  apiUrl: string;
  onMessage: (message: RealtimeMessage) => void;
  onStatusChange: (status: RealtimeStatus) => void;
}): { close: () => void } {
  let closed = false;
  let backoff = 1000;
  let socket: WebSocket | null = null;

  async function connect(reason: "initial" | "auth-rejected" | "reconnect"): Promise<void> {
    if (closed) return;
    options.onStatusChange(reason === "initial" ? "connecting" : "reconnecting");
    const token = await options.getToken(reason);
    if (closed) return;
    if (!token) {
      options.onStatusChange("closed");
      return;
    }

    socket = new WebSocket(wsUrlFromApiUrl(options.apiUrl, token, options.tenantId));
    socket.onopen = () => {
      backoff = 1000;
      options.onStatusChange("open");
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        options.onMessage(JSON.parse(event.data) as RealtimeMessage);
      } catch {
        // A malformed frame is dropped, never crashes the live-updates UI.
      }
    };
    socket.onclose = (event: CloseEvent) => {
      socket = null;
      if (closed) return;
      if (event.code === 4403) {
        options.onStatusChange("closed");
        return;
      }
      const nextReason = event.code === 4401 ? "auth-rejected" : "reconnect";
      const delay = nextReason === "auth-rejected" ? 0 : backoff;
      options.onStatusChange("reconnecting");
      setTimeout(() => void connect(nextReason), delay);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
    socket.onerror = () => socket?.close();
  }

  void connect("initial");
  return {
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}
