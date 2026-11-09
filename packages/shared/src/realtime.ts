/** The live-updates connection both apps use: one WebSocket to the API's
 * /ws, reconnecting with backoff, refreshing the token when the server
 * rejected it, and unpacking the server's batched frames. The caller supplies
 * the socket (the web's and React Native's WebSocket both fit). */

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
  // Diagnostics (generic firmware 0.14.0+; absent from a Last-Will).
  reset_reason?: string | null;
  boot_count?: number | null;
  heap_free?: number | null;
  heap_min?: number | null;
  wifi_reconnects?: number | null;
  faults?: string[] | null;
  // rule_execution: a rule fired — "just invalidate" like command_ack/
  // notification, not a payload to apply (the row is server-derived state).
  rule_id?: string;
  // rule_health: a rule's inputs went stale/missing (or recovered) — the
  // "can it currently evaluate" state flipped. Invalidate the rules views.
  evaluatable?: boolean;
}

/** The slice of WebSocket this module uses. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

// Timers exist in every runtime this package runs in (browser, React
// Native), but the package's tsc has no DOM or Node library.
declare function setTimeout(callback: () => void, ms: number): unknown;

const MAX_BACKOFF_MS = 15_000;

/** ws(s)://host/ws?token=…&tenant_id=… for an http(s) API URL. Plain string
 * work: React Native's URL can't set protocol or pathname. */
export function wsUrlFromApiUrl(apiUrl: string, token: string, tenantId: string): string {
  const match = /^(https?):\/\/([^/?#]+)/.exec(apiUrl.trim());
  if (!match) throw new Error(`Not an http(s) API URL: ${apiUrl}`);
  const scheme = match[1] === "https" ? "wss" : "ws";
  return `${scheme}://${match[2]}/ws?token=${encodeURIComponent(token)}&tenant_id=${encodeURIComponent(tenantId)}`;
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
  createSocket: (url: string) => SocketLike;
  onMessage: (message: RealtimeMessage) => void;
  onStatusChange: (status: RealtimeStatus) => void;
}): { close: () => void } {
  let closed = false;
  let backoff = 1000;
  let socket: SocketLike | null = null;

  async function connect(reason: "initial" | "auth-rejected" | "reconnect"): Promise<void> {
    if (closed) return;
    options.onStatusChange(reason === "initial" ? "connecting" : "reconnecting");
    const token = await options.getToken(reason);
    if (closed) return;
    if (!token) {
      options.onStatusChange("closed");
      return;
    }

    socket = options.createSocket(wsUrlFromApiUrl(options.apiUrl, token, options.tenantId));
    socket.onopen = () => {
      backoff = 1000;
      options.onStatusChange("open");
    };
    socket.onmessage = (event) => {
      let frame: RealtimeMessage | { type: "batch"; events: RealtimeMessage[] };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        // A malformed frame is dropped, never crashes the live-updates UI.
        return;
      }
      // The server coalesces a tick's events into one `batch` frame
      // (backend realtime/router.py); a lone event arrives as itself.
      const messages = frame.type === "batch" && "events" in frame ? frame.events : [frame as RealtimeMessage];
      for (const message of messages) {
        try {
          options.onMessage(message);
        } catch {
          // One bad event never drops the rest of its batch.
        }
      }
    };
    socket.onclose = (event) => {
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
