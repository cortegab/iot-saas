import { describe, expect, it } from "vitest";
import { connectRealtime, wsUrlFromApiUrl, type RealtimeMessage, type SocketLike } from "./realtime";

describe("wsUrlFromApiUrl", () => {
  it("maps http(s) to ws(s) on /ws with the token and workspace", () => {
    expect(wsUrlFromApiUrl("https://api.iodriven.tech", "a b", "t1")).toBe("wss://api.iodriven.tech/ws?token=a%20b&tenant_id=t1");
    expect(wsUrlFromApiUrl("http://localhost:8000/", "x", "t1")).toBe("ws://localhost:8000/ws?token=x&tenant_id=t1");
  });
});

describe("connectRealtime", () => {
  it("unpacks batched frames and drops malformed ones", async () => {
    let socket: SocketLike | undefined;
    const got: RealtimeMessage[] = [];
    const conn = connectRealtime({
      getToken: async () => "tok",
      tenantId: "t1",
      apiUrl: "https://api.example",
      createSocket: () => {
        socket = { onopen: null, onmessage: null, onclose: null, onerror: null, close: () => undefined };
        return socket;
      },
      onMessage: (m) => got.push(m),
      onStatusChange: () => undefined,
    });
    await new Promise((r) => setTimeout(r, 0));
    socket!.onmessage!({ data: JSON.stringify({ type: "batch", events: [{ type: "telemetry", metric: "t" }, { type: "notification" }] }) });
    socket!.onmessage!({ data: "not json" });
    socket!.onmessage!({ data: JSON.stringify({ type: "command_ack" }) });
    expect(got.map((m) => m.type)).toEqual(["telemetry", "notification", "command_ack"]);
    conn.close();
  });
});
